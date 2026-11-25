import { trimEnds } from './trimEnds'

/* 이름을 쓰는 칸의 글자 규칙(P-214). 서버가 기준이고 화면은 미리 알려 준다. */

const whiteSpace = /\p{White_Space}/u

/** 앞뒤의 공백류 글자를 지운다. trim()은 공백류가 아닌 U+FEFF도 지우고 U+0085는 남긴다. */
export function trimWhiteSpace(text: string): string {
  return trimEnds(text, (character) => whiteSpace.test(character))
}

/** 제어 문자, 서식 문자, 짝 없는 서로게이트, 줄·문단 구분 문자, 보이지 않는 글자. 변형 선택자가 여기에 든다. */
const unusable =
  /[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029\u115F\u1160\u2800\u3164\uFFA0]|[\u034F\u17B4\u17B5\u180B-\u180F\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/u

/** 이모지와 키캡. U+200D는 이모지 사이에서, U+FE0F는 이모지 바로 뒤와 키캡 속에서만 쓸 수 있다. */
const emoji =
  /\p{Extended_Pictographic}\uFE0F?\p{Emoji_Modifier}?(?:\u200D(?=\p{Extended_Pictographic}))?|[0-9#*]\uFE0F\u20E3/gu

/** 쓸 수 없는 글자가 있는지. 앞뒤의 공백류 글자도 글자로 보므로 먼저 지우고 부른다. */
export function hasUnusableCharacter(text: string): boolean {
  // 걷어 낸 자리의 양옆이 붙어 다른 글자가 되지 않게 공백을 둔다
  return unusable.test(text.replace(emoji, ' '))
}
