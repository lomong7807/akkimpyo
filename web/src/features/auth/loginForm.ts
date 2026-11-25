export interface LoginValues {
  email: string
  password: string
}

export type LoginField = keyof LoginValues

/** 화면 위쪽부터 놓인 순서 */
export const loginFields: LoginField[] = ['email', 'password']

/** 칸마다 오류 문구. 맞는 칸은 없다(화면설계서 A-02 입력값 오류). */
export function validateLogin({ email, password }: LoginValues): Partial<Record<LoginField, string>> {
  return { email: emailError(email), password: passwordError(password) }
}

/** 앞뒤의 일반 공백(U+0020, 탭, 줄바꿈). trim()은 서버가 거부하는 U+00A0과 U+FEFF까지 지우므로 쓰지 않는다. */
const surroundingSpaces = /^[ \t\n\f\r]+|[ \t\n\f\r]+$/g

/**
 * P-101의 이메일 형식: ASCII 인쇄 가능 문자이고 @가 하나이며 그 앞뒤에 글자가 있다. 서버가 받는 이메일을 막지 않도록
 * 더 엄격하게 보지 않는다.
 */
const emailFormat = /^[!-?A-~]+@[!-?A-~]+$/

/** 미리 알려 주려고 볼 뿐이다. 공백을 지우고 소문자로 바꾸는 기준은 서버이므로 쓴 값을 그대로 보낸다(#102). */
function emailError(email: string): string | undefined {
  const visible = email.replace(surroundingSpaces, '')
  if (visible === '') return '이메일을 입력해 주세요'
  if (!emailFormat.test(visible)) return '이메일 주소 형식을 확인해 주세요'
}

function passwordError(password: string): string | undefined {
  if (password === '') return '비밀번호를 입력해 주세요'
}
