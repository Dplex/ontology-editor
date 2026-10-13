// 준공 도면 PDF 의 한 쪽을 이미지로 그린다(OE-MAN-02). 그린 PNG 는 이미지 도면과 같은 길로 평면도 배경이 된다(background.ts).
//
// pdf.js 는 크다(워커 포함 약 1.5MB). PDF 를 고를 때에만 불러온다.
// 긴 변을 PDF_MAX_SIDE 픽셀로 그린다. 배경은 3D 의 텍스처 한 장이라 8192 로 그리면 그 한 장이 256MB 다. A1 도면(841mm)을 4096 으로
// 그리면 1px 이 종이에서 0.2mm 라 선을 따라 그리기에 모자라지 않다.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

export const PDF_MAX_SIDE = 4096

export type PdfPage = {
  /** 그린 쪽의 PNG. */
  blob: Blob
  /** 그린 크기(픽셀). */
  width: number
  height: number
  /** 몇 쪽인지(1부터)와 전체 쪽 수. */
  page: number
  pages: number
  /** PDF 1pt(1/72in) 가 몇 픽셀로 그려졌나. 쪽마다 종이 크기가 달라도 같은 축척을 이어 쓰려고 둔다. */
  pxPerPt: number
}

/** PDF 의 `page` 쪽(1부터)을 PNG 로 그린다. 쪽 번호가 범위를 벗어나면 가까운 끝 쪽을 그린다. */
export async function renderPdfPage(data: ArrayBuffer, page = 1): Promise<PdfPage> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  // pdf.js 는 넘긴 버퍼를 워커로 옮겨 비운다. 쪽을 바꿔 다시 그릴 수 있게 사본을 넘긴다.
  const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) })
  const doc = await task.promise
  try {
    const n = Math.min(Math.max(1, Math.round(page)), doc.numPages)
    const p = await doc.getPage(n)
    const base = p.getViewport({ scale: 1 })
    const pxPerPt = PDF_MAX_SIDE / Math.max(base.width, base.height)
    const viewport = p.getViewport({ scale: pxPerPt })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    // 배경을 흰색으로 칠한다(pdf.js 기본). 투명으로 두면 3D 바닥 색이 비쳐 선이 묻힌다.
    await p.render({ canvas, viewport }).promise
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PDF 쪽을 이미지로 바꾸지 못했습니다'))), 'image/png'))
    return { blob, width: canvas.width, height: canvas.height, page: n, pages: doc.numPages, pxPerPt }
  } finally {
    // 워커와 문서를 놓아 준다. 쪽을 바꿀 때마다 새로 연다.
    void task.destroy()
  }
}
