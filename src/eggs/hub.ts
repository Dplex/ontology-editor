// `~` 판 — 숨은 연출을 켜고 끄는 작은 목록. 콘솔 게임의 `~` 콘솔에 바치는 오마주다(docs/plans/easter-eggs.md 3장).
// 키(1~9 · Esc)는 껍데기(editor/eggs.ts)가 받는다. 판은 그리기와 누르기만 한다. `?` 안내에는 올리지 않는다 — 숨은 것이라서다.
import './hub.css'
import type { Egg } from './types'

export type HubHost = {
  eggs: readonly Egg[]
  isOn(id: string): boolean
  toggle(id: string): void
}

export function createHub(root: HTMLElement, host: HubHost) {
  const el = document.createElement('section')
  el.className = 'egg-hub'
  el.dataset.testid = 'egg-hub'
  el.setAttribute('aria-label', '숨은 연출')

  const head = document.createElement('p')
  head.className = 'egg-hub-head'
  head.textContent = '~ eggs'
  const list = document.createElement('ol')
  const foot = document.createElement('p')
  foot.className = 'egg-hub-foot'
  foot.textContent = host.eggs.length ? '1–9 켜기·끄기 · Esc 닫기 · 화면에서만 바뀝니다' : '아직 든 것이 없습니다 · Esc 닫기'

  const buttons = host.eggs.slice(0, 9).map((egg, i) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.dataset.egg = egg.id
    const key = document.createElement('kbd')
    key.textContent = String(i + 1)
    key.setAttribute('aria-hidden', 'true')
    const id = document.createElement('span')
    id.className = 'egg-id'
    id.textContent = egg.id
    const title = document.createElement('span')
    title.className = 'egg-title'
    title.textContent = egg.title
    b.append(key, id, title)
    b.addEventListener('click', () => host.toggle(egg.id))
    const li = document.createElement('li')
    li.append(b)
    list.append(li)
    return b
  })

  el.append(head, list, foot)
  root.append(el)

  function update() {
    for (const b of buttons) b.setAttribute('aria-pressed', String(host.isOn(b.dataset.egg!)))
  }
  update()

  return {
    update,
    dispose: () => el.remove(),
  }
}
