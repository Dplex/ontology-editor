const documents = import.meta.glob('../../features/**/OE-*.md', {query:'?raw',import:'default',eager:true}) as Record<string,string>
export const catalog = Object.entries(documents).map(([path,raw]) => {
  const header = raw.split('---')[1] ?? ''
  const field = (name: string) => {
    const line = header.split('\n').find(l => l.startsWith(name + ':'))
    try { return JSON.parse(line?.slice(name.length+1).trim() ?? '""') as string } catch { return '' }
  }
  return {id:field('id'),title:field('title'),epic:field('epic_title'),release:field('release'),priority:field('priority'),
    status:field('status'),requirement:raw.split('## 요구사항')[1]?.split('## 수용 기준')[0]?.trim() ?? '',
    criteria:raw.split('## 수용 기준')[1]?.split('## 검증')[0]?.trim() ?? '',path}
}).sort((a,b) => a.id.localeCompare(b.id))
