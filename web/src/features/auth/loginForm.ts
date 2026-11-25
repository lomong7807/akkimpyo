export interface LoginValues {
  email: string
  password: string
}

export type LoginField = keyof LoginValues

/** 화면 위쪽부터 놓인 순서 */
export const loginFields: LoginField[] = ['email', 'password']

/** 보낼 때의 이메일(P-101). 화면의 값은 바꾸지 않는다. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** 칸마다 오류 문구. 맞는 칸은 없다(화면설계서 A-02 입력값 오류). */
export function validateLogin({ email, password }: LoginValues): Partial<Record<LoginField, string>> {
  return { email: emailError(normalizeEmail(email)), password: passwordError(password) }
}

function emailError(email: string): string | undefined {
  if (email === '') return '이메일을 입력해 주세요'
  // 서버가 받는 이메일을 화면이 막지 않도록 서버와 같은 규칙(@ 하나와 앞뒤 한 글자 이상)만 본다
  if (!/^[^@]+@[^@]+$/.test(email)) return '이메일 주소 형식을 확인해 주세요'
}

function passwordError(password: string): string | undefined {
  if (password === '') return '비밀번호를 입력해 주세요'
}
