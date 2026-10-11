// BIM 필수 요구를 어긴 요소(issue-list.ts)를 BCF 2.1 로 낸다(ADR-0051). BCF 는 BIM 이슈를 주고받는 표준(buildingSMART)이라
// 받는 도구에서 열면 이슈마다 그 요소가 골라지고 카메라가 그쪽을 본다. 라이선스 없이 보려면 BIMcollab Zoom 무료판(IFC + BCF 가져오기),
// 설계사의 Revit·Navisworks 는 BCF 를 기본으로 읽지 않아 BCF Manager 플러그인(BIMcollab 등)으로 연다.
//
// 이슈(토픽)는 요소마다가 아니라 (R 번호 · 규칙 · 층)마다 하나다 — Duplex 만 해도 어긴 요소가 수백 개라 요소마다 만들면 목록이 쓸모없다.
// 토픽의 보기(viewpoint)는 그 요소들을 다 고르고(IfcGuid), 카메라는 그 요소들의 범위를 비스듬히 내려다본다. GlobalId 가 아닌 id
// (사람이 더한 것 등)는 고를 수 없어 설명에만 적는다. 요소 하나하나는 같이 내는 CSV 에 있다.

import { MISSING_LABEL } from '../build-report'
import type { IssueItem } from '../issue-list'
import type { Vec3 } from '../model'
import { storeZip } from '../zip'

const IFC_GUID = /^[0-9A-Za-z_$]{22}$/

const xml = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)

export type BcfTopic = { guid: string; viewpoint: string; title: string; labels: string[]; description: string; guids: string[]; camera: Camera | null }
type Camera = { at: Vec3; dir: Vec3; up: Vec3 }

/** 요소들의 범위를 비스듬히(남서쪽 위에서) 내려다보는 카메라. 좌표는 IFC 세계 좌표(m, Z 위). */
export function cameraFor(points: readonly Vec3[]): Camera | null {
  if (!points.length) return null
  const axis = (k: 0 | 1 | 2, f: (...v: number[]) => number) => f(...points.map((p) => p[k]))
  const lo: Vec3 = [axis(0, Math.min), axis(1, Math.min), axis(2, Math.min)]
  const hi: Vec3 = [axis(0, Math.max), axis(1, Math.max), axis(2, Math.max)]
  const c: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]
  const d = Math.max(6, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]))
  const at: Vec3 = [c[0] - d * 0.7, c[1] - d * 0.7, c[2] + d * 0.8]
  const norm = (v: Vec3): Vec3 => {
    const n = Math.hypot(v[0], v[1], v[2])
    return [v[0] / n, v[1] / n, v[2] / n]
  }
  const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const dir = norm([c[0] - at[0], c[1] - at[1], c[2] - at[2]])
  // 위 벡터는 시선에 수직이고 Z 쪽을 향한다: (시선 × Z) × 시선
  const up = norm(cross(cross(dir, [0, 0, 1]), dir))
  return { at, dir, up }
}

/** 이슈 목록 → 토픽. guid 는 newGuid 로 짓는다(시험은 정해진 값을 넣는다). */
export function bcfTopics(items: readonly IssueItem[], newGuid: () => string = () => crypto.randomUUID()): BcfTopic[] {
  const groups = new Map<string, IssueItem[]>()
  for (const i of items) {
    const k = `${i.r}|${i.cls}|${i.rule}|${i.storey}`
    const g = groups.get(k)
    if (g) g.push(i)
    else groups.set(k, [i])
  }
  const order = [...groups.values()].sort((a, b) => a[0].r.localeCompare(b[0].r, undefined, { numeric: true }) || a[0].storey.localeCompare(b[0].storey))
  return order.map((g) => {
    const first = g[0]
    const guids = [...new Set(g.map((i) => i.id).filter((id) => IFC_GUID.test(id)))]
    const problems = [...new Set(g.map((i) => i.problem))]
    const lines = g.slice(0, 40).map((i) => `- ${i.name || '(이름 없음)'}${i.revitId ? ` [Revit ${i.revitId}]` : ''} — ${i.problem}`)
    const description = [
      `${first.rule}`,
      `${MISSING_LABEL[first.cls]} · ${first.r} · ${first.storey} · ${g.length}개`,
      problems.length === 1 ? `무엇이 없나: ${problems[0]}` : `무엇이 없나: ${problems.join(' / ')}`,
      first.ask ? `요청: ${first.ask}` : '',
      '',
      ...lines,
      g.length > lines.length ? `… 외 ${g.length - lines.length}개(같이 낸 CSV 에 전부 있음)` : '',
    ].filter((l) => l !== '').join('\n')
    return {
      guid: newGuid(),
      viewpoint: newGuid(),
      title: `${first.r} ${MISSING_LABEL[first.cls]} ${first.rule} — ${first.storey} (${g.length}개)`,
      labels: [first.r, MISSING_LABEL[first.cls]],
      description,
      guids,
      camera: cameraFor(g.map((i) => i.at).filter((p): p is Vec3 => !!p)),
    }
  })
}

const VERSION = `<?xml version="1.0" encoding="UTF-8"?>
<Version VersionId="2.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="version.xsd">
  <DetailedVersion>2.1</DetailedVersion>
</Version>
`

function markup(t: BcfTopic, files: readonly string[], date: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Markup xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="markup.xsd">
  <Header>
${files.map((f) => `    <File isExternal="true">\n      <Filename>${xml(f)}</Filename>\n    </File>`).join('\n')}
  </Header>
  <Topic Guid="${t.guid}" TopicType="Issue" TopicStatus="Open">
    <Title>${xml(t.title)}</Title>
${t.labels.map((l) => `    <Labels>${xml(l)}</Labels>`).join('\n')}
    <CreationDate>${date}</CreationDate>
    <CreationAuthor>ontology-editor</CreationAuthor>
    <Description>${xml(t.description)}</Description>
  </Topic>
  <Viewpoints Guid="${t.viewpoint}">
    <Viewpoint>viewpoint.bcfv</Viewpoint>
  </Viewpoints>
</Markup>
`
}

const v3 = (tag: string, v: Vec3) => `    <${tag}>\n      <X>${v[0].toFixed(4)}</X>\n      <Y>${v[1].toFixed(4)}</Y>\n      <Z>${v[2].toFixed(4)}</Z>\n    </${tag}>`

function viewpoint(t: BcfTopic): string {
  const cam = t.camera
    ? `  <PerspectiveCamera>
${v3('CameraViewPoint', t.camera.at)}
${v3('CameraDirection', t.camera.dir)}
${v3('CameraUpVector', t.camera.up)}
    <FieldOfView>60</FieldOfView>
  </PerspectiveCamera>
`
    : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<VisualizationInfo Guid="${t.viewpoint}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="visinfo.xsd">
  <Components>
${t.guids.length ? `    <Selection>\n${t.guids.map((g) => `      <Component IfcGuid="${xml(g)}" />`).join('\n')}\n    </Selection>\n` : ''}    <Visibility DefaultVisibility="true" />
  </Components>
${cam}</VisualizationInfo>
`
}

/** BCF zip. files 는 이슈가 가리키는 IFC 파일 이름(헤더에 적는다). */
export function issuesToBCF(items: readonly IssueItem[], { files = [], project = '', date = new Date().toISOString(), newGuid }: { files?: readonly string[]; project?: string; date?: string; newGuid?: () => string } = {}): Uint8Array {
  const topics = bcfTopics(items, newGuid)
  const gid = newGuid ?? (() => crypto.randomUUID())
  const entries: { name: string; data: string }[] = [{ name: 'bcf.version', data: VERSION }]
  if (project) {
    entries.push({
      name: 'project.bcfp',
      data: `<?xml version="1.0" encoding="UTF-8"?>\n<ProjectExtension xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="project.xsd">\n  <Project ProjectId="${gid()}">\n    <Name>${xml(project)}</Name>\n  </Project>\n  <ExtensionSchema></ExtensionSchema>\n</ProjectExtension>\n`,
    })
  }
  for (const t of topics) {
    entries.push({ name: `${t.guid}/markup.bcf`, data: markup(t, files, date) })
    entries.push({ name: `${t.guid}/viewpoint.bcfv`, data: viewpoint(t) })
  }
  return storeZip(entries)
}
