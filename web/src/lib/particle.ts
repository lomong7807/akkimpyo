/* 이름 뒤에 붙이는 조사. 이름은 사용자가 정하므로 받침에 따라 고른다. */

const HANGUL_FIRST = 0xac00
const HANGUL_LAST = 0xd7a3
/** 한 음절의 받침 가짓수(받침 없음 포함) */
const FINALS = 28
/** 받침 ㄹ의 순번 */
const RIEUL = 8

/** 숫자를 읽는 소리의 받침. 0은 영, 십, 백, 천, 만으로 읽어 모두 받침이 있다. */
const digitFinal: Record<string, 'none' | 'rieul' | 'other'> = {
  '0': 'other',
  '1': 'rieul',
  '2': 'none',
  '3': 'other',
  '4': 'none',
  '5': 'none',
  '6': 'other',
  '7': 'rieul',
  '8': 'rieul',
  '9': 'none',
}

/** 끝에서 건너뛰는 글자: 공백, 괄호, 문장 부호 */
const TRAILING = /[\s()[\]{}.,!?'"·-]+$/u

/**
 * 방향을 나타내는 "(으)로"(예: "국민은행에서 국민카드로", "신한카드에서 지갑으로").
 * 받침이 없거나 ㄹ 받침이면 "로", 다른 받침이면 "으로"다. 한글이나 숫자로 끝나지 않으면 받침을 알 수 없어 "(으)로"다.
 */
export function towardParticle(word: string): '로' | '으로' | '(으)로' {
  const last = word.replace(TRAILING, '').at(-1) ?? ''
  const final = finalOf(last)
  if (final === undefined) return '(으)로'
  return final === 'other' ? '으로' : '로'
}

function finalOf(character: string): 'none' | 'rieul' | 'other' | undefined {
  if (character in digitFinal) return digitFinal[character]
  const code = character.codePointAt(0)
  if (code === undefined || code < HANGUL_FIRST || code > HANGUL_LAST) return undefined
  const final = (code - HANGUL_FIRST) % FINALS
  if (final === 0) return 'none'
  return final === RIEUL ? 'rieul' : 'other'
}
