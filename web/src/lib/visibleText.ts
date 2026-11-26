import { trimEnds } from './trimEnds'

/*
 * 사용자가 넣는 글자의 규칙(P-214). 서버가 기준이고 화면은 미리 알려 준다.
 * 서버 server/src/main/java/app/accountbook/common/UserText.java와 같은 글자 목록과 같은 판정을 쓴다.
 */

/**
 * 앞뒤에서 지우는 공백류 글자: 유니코드 Zs 17자(서버 UserText.TRIMMED_SPACES).
 * 탭, 줄바꿈, U+0085, U+2028은 공백류가 아니라 거부 글자라서 앞뒤에 있어도 지우지 않는다.
 */
export const TRIMMED_SPACES =
  '\u{20}\u{A0}\u{1680}\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}\u{2005}\u{2006}' +
  '\u{2007}\u{2008}\u{2009}\u{200A}\u{202F}\u{205F}\u{3000}'

/** 앞뒤의 공백류 글자(TRIMMED_SPACES)를 지운다. trim()은 탭과 줄바꿈과 U+FEFF까지 지워 쓰지 않는다. */
export function trimSpaces(text: string): string {
  return trimEnds(text, (character) => TRIMMED_SPACES.includes(character))
}

/** 서버가 검사하고 저장하는 이름. 앞뒤의 공백류를 지우고 조합형으로 맞춘다. */
export function normalizeName(name: string): string {
  return trimSpaces(name).normalize('NFC')
}

/** 서버와 같이 코드포인트를 센다. */
export function lengthOf(text: string): number {
  return [...text].length
}

/** 짝 없는 서로게이트. 짝이 맞는 것은 [...text]에서 한 글자로 합쳐지고 짝 없는 것만 홀로 남는다. */
const surrogate = /^\p{Cs}$/u

/**
 * 거부 글자: 제어 문자(Cc), 서식 문자(Cf), 줄·문단 구분 문자, 보이지 않는 글자.
 * 보이지 않는 글자는 Cf가 아니라서 따로 적는다(변형 선택자 U+FE00~U+FE0F가 여기에 든다).
 * 결합 문자(U+034F, U+17B4, U+17B5, U+180B~U+180D, 변형 선택자)는 다른 글자와 붙어 보이지 않게 뒤쪽 묶음에 따로 둔다.
 */
const forbidden =
  /^(?:[\p{Cc}\p{Cf}\u{2028}\u{2029}\u{115F}\u{1160}\u{2800}\u{3164}\u{FFA0}]|[\u{34F}\u{17B4}\u{17B5}\u{180B}-\u{180F}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}])$/u

/** 이모지. 서버의 Character.isExtendedPictographic과 같은 유니코드 속성이다. */
const pictographic = /^\p{Extended_Pictographic}$/u

const ZERO_WIDTH_JOINER = '\u{200D}'
const EMOJI_PRESENTATION_SELECTOR = '\u{FE0F}'
const COMBINING_KEYCAP = '\u{20E3}'
const skinTone = /^[\u{1F3FB}-\u{1F3FF}]$/u
const keycapBase = /^[0-9#*]$/

export interface UnusableCharacterOptions {
  /** 메모는 줄바꿈(U+000A)을 더 받는다. */
  allowLineFeed?: boolean
}

/**
 * 서버가 거부하는 글자가 있는지(P-214). 이모지를 이루는 자리의 U+200D와 U+FE0F만 받는다.
 * 서버처럼 앞뒤를 지우거나 조합형으로 맞추기 전의 값, 곧 쓴 그대로의 값에 부른다.
 */
export function hasUnusableCharacter(text: string, { allowLineFeed = false }: UnusableCharacterOptions = {}): boolean {
  const characters = [...text]
  return characters.some(
    (character, i) =>
      surrogate.test(character) ||
      (!(allowLineFeed && character === '\n') && forbidden.test(character) && !isPartOfEmoji(characters, i)),
  )
}

/**
 * 거부 글자 가운데 이모지를 이루는 자리의 U+200D와 U+FE0F. U+200D는 앞이 이모지(뒤에 피부색이나 U+FE0F가 하나 붙은 것
 * 포함)이고 뒤가 이모지일 때, U+FE0F는 이모지 바로 뒤이거나 `0-9 # *`와 U+20E3 사이일 때다.
 */
function isPartOfEmoji(characters: string[], i: number): boolean {
  const character = characters[i]
  const hasPrevious = i > 0
  const hasNext = i + 1 < characters.length
  if (character === ZERO_WIDTH_JOINER) {
    return hasPrevious && hasNext && endsEmoji(characters, i - 1) && pictographic.test(characters[i + 1])
  }
  if (character === EMOJI_PRESENTATION_SELECTOR) {
    return (
      hasPrevious &&
      (pictographic.test(characters[i - 1]) ||
        (keycapBase.test(characters[i - 1]) && hasNext && characters[i + 1] === COMBINING_KEYCAP))
    )
  }
  return false
}

/** characters[end]에서 끝나는 이모지인가: 이모지 하나, 또는 이모지 뒤에 피부색이나 U+FE0F 하나. */
function endsEmoji(characters: string[], end: number): boolean {
  const character = characters[end]
  if (skinTone.test(character) || character === EMOJI_PRESENTATION_SELECTOR) {
    return end > 0 && pictographic.test(characters[end - 1])
  }
  return pictographic.test(character)
}
