---
id: "ADR-0053"
title: "PDF 도면 배경은 브라우저에서 pdf.js 로 한 쪽을 PNG 로 그려 이미지 배경과 같은 길로 깔고, 쪽을 바꿔도 종이 위 축척을 이어 쓴다"
status: "제안"
date: "2026-10-12"
deciders: []
prd: []
tickets: ["OE-MAN-02"]
criteria: ["OE-MAN-02#1"]
code: ["src/lib/pdf-page.ts", "src/lib/background.ts", "src/App.vue", "scripts/serve.mjs"]
tests: ["src/lib/background.test.ts", "e2e/background.spec.ts"]
related: []
---

# ADR-0053 PDF 도면 배경 — pdf.js 로 한 쪽을 이미지로

## 맥락

OE-MAN-02 는 준공 도면(PDF·DWG)을 평면도 배경으로 깐다. PR #444 가 이미지(PNG·JPG)와 스케일·원점 맞추기를 넣었고, PDF·DWG 는
이미지로 내보낸 뒤 고르게 했다. 고객사가 보내는 준공 도면은 대개 PDF 이고, 층마다 한 쪽씩 든 묶음 PDF 가 흔하다.

## 결정

브라우저에서 pdf.js(`pdfjs-dist` 6.3)로 한 쪽을 캔버스에 그려 PNG 로 만들고, 이미지 도면과 같은 길(`initialBackground`)로 깐다.
스케일·원점 맞추기는 그대로 쓴다. pdf.js 는 PDF 를 고를 때에만 불러온다(본체 483KB, 워커 1.27MB).

- **긴 변을 4096px 로 그린다.** 배경은 3D 텍스처 한 장이라 8192px 이면 그 한 장이 256MB 다. A1(841mm)을 4096px 로 그리면 종이에서
  1px 이 0.2mm 라 선을 따라 그리기에 충분하다. 선 2만 개인 A1 PDF 가 1.3초에 그려졌다
- **여러 쪽이면 [쪽] 칸에서 바꾼다.** 바꿔도 왼쪽 위와 종이 위 축척(PDF 1pt 가 몇 m)을 그대로 둔다(`switchPdfPage`). 한 묶음 도면은
  쪽마다 축척이 같아서, 한 쪽에서 맞춘 스케일을 다른 층 쪽에 이어 쓴다. 쪽마다 종이 크기가 달라 픽셀 크기가 달라도 같다
- **`serve.mjs` 가 `.mjs` 를 JavaScript 로 준다.** pdf.js 워커가 `.mjs` 로 빌드되는데, 모듈 워커는 JavaScript 타입이 아니면 브라우저가
  실행하지 않는다. 이 줄이 없으면 55(8084)에서는 PDF 가 열리지 않았다("Strict MIME type checking is enforced for module scripts")

## 고려한 다른 길

- 서버에서 PDF 를 이미지로 바꾸기: 배경은 브라우저 탭에만 있는 작업 보조라 서버가 할 일이 없다. 서버 없이 띄운 dev 화면에서도 된다
- 쪽마다 처음처럼 건물 너비에 맞춰 다시 깔기: 맞춘 스케일을 쪽마다 다시 맞춰야 한다

## 결과

- PNG·JPG·PDF 를 같은 칸에서 고른다. DWG 는 여전히 PDF 나 이미지로 내보낸 뒤 고른다. 브라우저만으로는 DWG 를 읽을 수 없어 변환
  서버가 필요하다(#118 코멘트)
- PDF 도 배경은 온톨로지·편집 파일에 나가지 않고 이 탭에만 있다. 다시 열면 다시 깐다
- 되돌리려면: `pickBackground` 의 PDF 갈래·`pickPdfBackground`·`setBackgroundPage`·[쪽] 칸을 지우고 `src/lib/pdf-page.ts`, `pdfjs-dist`
  의존성, `serve.mjs` 의 `.mjs` 줄을 지운다. 이미지 도면은 그대로다
