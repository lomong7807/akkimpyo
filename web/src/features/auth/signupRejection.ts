import { ApiError, type FieldError } from '../../api/apiError'
import type { FieldErrors } from '../../components/useFormFields'
import { invalidEmail } from './email'
import { nameRequired, nameTooLong, nameUnusable, passwordRule, passwordTooLong, type SignupField } from './signupForm'

/* 가입이 거부된 입력란의 이름과 code(ADR 002 4절, #29)는 이 파일에만 있다. */

/** 서버가 거부한 칸의 문구. 어느 칸인지 알 수 없는 실패면 없다. */
export function rejectedFields(error: Error): FieldErrors<SignupField> | undefined {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_FAILED') return undefined
  const rejected: FieldErrors<SignupField> = Object.assign({}, ...error.fieldErrors.map(messageOf))
  return Object.keys(rejected).length > 0 ? rejected : undefined
}

function messageOf({ field, code }: FieldError): FieldErrors<SignupField> {
  switch (field) {
    case 'email':
      return { email: emailMessage(code) }
    case 'password':
      return { password: code === 'TOO_LONG' ? passwordTooLong : passwordRule }
    case 'displayName':
      return { displayName: displayNameMessage(code) }
    default:
      return {}
  }
}

function emailMessage(code: string): string {
  switch (code) {
    case 'DUPLICATE':
      return '이미 가입된 이메일이에요. 로그인해 주세요.'
    case 'NOT_ALLOWED':
      return '지금은 허용된 이메일만 가입할 수 있어요'
    default:
      return invalidEmail
  }
}

function displayNameMessage(code: string): string {
  switch (code) {
    case 'REQUIRED':
      return nameRequired
    case 'TOO_LONG':
      return nameTooLong
    default:
      return nameUnusable
  }
}
