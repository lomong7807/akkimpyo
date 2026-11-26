import { trimEnds } from '../../components/trimEnds'

export const invalidEmail = '이메일 주소 형식을 확인해 주세요'

/** 앞뒤의 일반 공백(U+0020, 탭, 줄바꿈). trim()은 서버가 거부하는 U+00A0과 U+FEFF까지 지우므로 쓰지 않는다. */
const spaces = ' \t\n\f\r'

/**
 * P-101의 이메일 형식: ASCII 인쇄 가능 문자이고 @가 하나이며 그 앞뒤에 글자가 있다. 서버가 받는 이메일을 막지 않도록
 * 더 엄격하게 보지 않는다.
 */
const emailFormat = /^[!-?A-~]+@[!-?A-~]+$/

/** 서버가 저장할 때처럼 앞뒤 공백을 지운 값. 보내는 값은 쓴 그대로다. */
export function trimEmail(email: string): string {
  return trimEnds(email, (character) => spaces.includes(character))
}

/** 미리 알려 주려고 볼 뿐이다. 공백을 지우고 소문자로 바꾸는 기준은 서버이므로 쓴 값을 그대로 보낸다(#102). */
export function emailError(email: string): string | undefined {
  const trimmed = trimEmail(email)
  if (trimmed === '') return '이메일을 입력해 주세요'
  if (!emailFormat.test(trimmed)) return invalidEmail
}
