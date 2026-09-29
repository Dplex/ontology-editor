// 이름 뒤에 붙는 조사를 받침에 맞게 고른다. 알림과 리포트는 설비·방 이름을 그대로 끼워 넣어서, 고정된 "을" 이면
// "OFFICE을", "FCU3 #958283을 지웠습니다" 처럼 틀린다. 영문·숫자는 읽는 소리로 가른다.

type Pair = '을/를' | '이/가' | '은/는' | '과/와'

/** 끝 글자에 받침이 있나. 모르면(기호로 끝남) null. */
export function hasBatchim(word: string): boolean | null {
  const w = word.replace(/[\s)\]}"'”’.,:;!?-]+$/u, '')
  const c = w.at(-1)
  if (!c) return null
  const code = c.charCodeAt(0)
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0
  // 영(0) 일(1) 이(2) 삼(3) 사(4) 오(5) 육(6) 칠(7) 팔(8) 구(9)
  if (/[0-9]/.test(c)) return '013678'.includes(c)
  if (/[A-Za-z]/.test(c)) {
    const letters = w.match(/[A-Za-z]+$/)![0]
    // 머리글자(AHU, TPS, L)는 글자 이름으로 읽는다: 엘·엠·엔·알만 받침이 있다.
    if (letters.length <= 4 && letters === letters.toUpperCase()) return 'LMNR'.includes(letters.at(-1)!)
    // 낱말은 소리로: -ng(파킹)·-l(홀)·-m(룸)·-n(스테이션)만 받침이 남는다. Stair·Water 의 r 은 소리가 없다.
    const low = letters.toLowerCase()
    return /(ng|l|m|n)$/.test(low)
  }
  return null
}

/** 조사만 돌려준다. 받침을 모르면 "을(를)" 처럼 둘 다 적는다. */
export function josa(word: string, pair: Pair): string {
  const [yes, no] = pair.split('/')
  const b = hasBatchim(word)
  return b === null ? `${yes}(${no})` : b ? yes : no
}
