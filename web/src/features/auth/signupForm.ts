import { emailError, invalidEmail, trimEmail } from './email'
import type { FieldErrors } from './useFormFields'
import { hasUnusableCharacter, trimWhiteSpace } from './visibleText'

export interface SignupValues {
  email: string
  password: string
  passwordConfirm: string
  displayName: string
}

export type SignupField = keyof SignupValues

/** 화면 위쪽부터 놓인 순서 */
export const signupFields: SignupField[] = ['email', 'password', 'passwordConfirm', 'displayName']

// 서버가 같은 까닭으로 거부해도 쓰는 문구
export const passwordRule = '8자 이상, 영문과 숫자를 함께 써 주세요'
export const passwordTooLong = '72자까지 쓸 수 있어요'
export const nameRequired = '표시 이름을 입력해 주세요'
export const nameTooLong = '1자부터 20자까지 쓸 수 있어요'
export const nameUnusable = '쓸 수 없는 글자가 있어요. 지우고 다시 써 주세요.'

/** 칸마다 오류 문구. 맞는 칸은 없다(화면설계서 A-03 입력값 오류). */
export function validateSignup(values: SignupValues): FieldErrors<SignupField> {
  return {
    email: newEmailError(values.email),
    password: newPasswordError(values.password),
    passwordConfirm: passwordConfirmError(values.password, values.passwordConfirm),
    displayName: displayNameError(values.displayName),
  }
}

export interface NewAccount {
  email: string
  password: string
  displayName: string
}

/**
 * 서버에 보낼 값. 맞추는 것은 서버이므로 쓴 그대로다.
 * 표시 이름만 조합형으로 맞춘다. 서버가 받은 값의 글자 수를 세므로(#123 전), 맥에서 복사한 분해형 한글이
 * 화면의 검사만 지나고 거부되지 않게 한다.
 */
export function toNewAccount({ email, password, displayName }: SignupValues): NewAccount {
  return { email, password, displayName: displayName.normalize('NFC') }
}

function newEmailError(email: string): string | undefined {
  return emailError(email) ?? (trimEmail(email).length > 254 ? invalidEmail : undefined)
}

function newPasswordError(password: string): string | undefined {
  const normalized = normalizePassword(password)
  if (normalized === '') return '비밀번호를 입력해 주세요'
  if (lengthOf(normalized) > 72) return passwordTooLong
  if (lengthOf(normalized) < 8 || !/[a-z]/i.test(normalized) || !/[0-9]/.test(normalized)) return passwordRule
}

function passwordConfirmError(password: string, passwordConfirm: string): string | undefined {
  if (passwordConfirm === '') return '비밀번호 확인을 입력해 주세요'
  if (normalizePassword(password) !== normalizePassword(passwordConfirm)) return '비밀번호가 서로 달라요'
}

function displayNameError(displayName: string): string | undefined {
  const name = trimWhiteSpace(displayName).normalize('NFC')
  if (name === '') return nameRequired
  if (hasUnusableCharacter(name)) return nameUnusable
  if (lengthOf(name) > 20) return nameTooLong
}

/** 서버가 검사하고 저장하는 비밀번호(P-101) */
function normalizePassword(password: string): string {
  return password.normalize('NFKC')
}

/** 서버와 같이 코드포인트를 센다. */
function lengthOf(text: string): number {
  return [...text].length
}
