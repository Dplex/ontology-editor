import type { Page } from '@playwright/test'

// 편집 대상 [공간 | 설비](OE-UI-04). 팔레트가 그 모드의 도구만 보이고, 다른 모드의 오브젝트는 끌거나 방향키로 옮기지 못한다. 이미 그 모드면 아무것도 하지 않는다.
async function to(page: Page, name: '공간' | '설비') {
  const button = page.getByRole('group', { name: '편집 대상' }).getByRole('button', { name, exact: true })
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click()
}
export const toSpace = (page: Page) => to(page, '공간')
export const toEquipment = (page: Page) => to(page, '설비')
