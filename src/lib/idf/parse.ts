// EnergyPlus IDF 를 객체 목록으로 읽는다.
//
// IDF 는 "클래스, 값, 값, …;" 가 이어진 글이다. 값은 쉼표로, 객체는 세미콜론으로 끝나고 `!` 뒤는 줄 끝까지 주석이다.
// 따옴표가 없어서 값 안에 쉼표·세미콜론이 올 수 없다(EnergyPlus 규칙). 클래스 이름은 대소문자를 가리지 않는다 —
// DesignBuilder 는 `Zone`, OpenStudio 는 `OS:Zone` 이 아니라 IDF 로 내보내면 `Zone` 이지만, 손으로 쓴 파일은 `ZONE` 도 있다.

export type IdfObject = {
  /** 파일에 적힌 클래스 이름(`BuildingSurface:Detailed`). */
  cls: string
  /** 비교용 소문자 클래스 이름. */
  key: string
  /** 클래스 뒤의 값들. 빈 값은 빈 문자열로 남는다(자리가 뜻을 가진다). */
  fields: string[]
}

export function parseIdf(text: string): IdfObject[] {
  const stripped = text.replace(/!.*$/gm, '')
  const out: IdfObject[] = []
  for (const chunk of stripped.split(';')) {
    const parts = chunk.split(',').map((x) => x.trim())
    const cls = parts[0]
    if (!cls) continue
    out.push({ cls, key: cls.toLowerCase(), fields: parts.slice(1) })
  }
  return out
}

/** 클래스별로 묶는다. 이름(첫 값)으로도 찾을 수 있게 소문자 이름 → 객체 표를 같이 둔다. */
export function indexIdf(objects: readonly IdfObject[]) {
  const byClass = new Map<string, IdfObject[]>()
  const byName = new Map<string, IdfObject[]>()
  for (const o of objects) {
    byClass.set(o.key, [...(byClass.get(o.key) ?? []), o])
    const name = (o.fields[0] ?? '').toLowerCase()
    if (name) byName.set(name, [...(byName.get(name) ?? []), o])
  }
  return {
    all: (cls: string) => byClass.get(cls.toLowerCase()) ?? [],
    /** 그 클래스에서 이름이 같은 객체. */
    named: (cls: string, name: string) => (byName.get(name.toLowerCase()) ?? []).find((o) => o.key === cls.toLowerCase()) ?? null,
    /** 클래스와 상관없이 이름이 같은 객체들. */
    byName: (name: string) => byName.get(name.toLowerCase()) ?? [],
    has: (cls: string) => byClass.has(cls.toLowerCase()),
  }
}

export type IdfIndex = ReturnType<typeof indexIdf>

/** 숫자 값. 비었거나 `autocalculate` 같은 말이면 null 이다. */
export function num(v: string | undefined): number | null {
  if (v === undefined || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
