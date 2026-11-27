import type { FieldErrors } from '../../components/useFormFields'
import { emailError } from './email'

export interface LoginValues {
  email: string
  password: string
}

export type LoginField = keyof LoginValues

/** 화면 위쪽부터 놓인 순서 */
export const loginFields: LoginField[] = ['email', 'password']

/** 칸마다 오류 문구. 맞는 칸은 없다(화면설계서 A-02 입력값 오류). */
export function validateLogin({ email, password }: LoginValues): FieldErrors<LoginField> {
  return { email: emailError(email), password: passwordError(password) }
}

function passwordError(password: string): string | undefined {
  if (password === '') return '비밀번호를 입력해 주세요'
}
