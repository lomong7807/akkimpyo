import { ApiError, type FieldError } from '../../api/apiError'
import { amountTooLarge } from '../../components/AmountField'
import type { FieldErrors } from '../../components/useFormFields'
import { formatDate, selectableRange, today } from '../../lib/calendarDate'
import { accountAddMessages, type AccountField, type AccountMessages } from './accountForm'

/* 계좌 추가가 거부된 칸의 code(#13의 응답 계약)는 이 파일에만 있다. 칸의 이름은 보내는 값(NewAccount)과 같다. */

/** 서버가 거부한 칸의 문구. 아는 칸과 code가 하나도 없으면 없다. */
export function rejectedFields(
  error: Error,
  messages: AccountMessages = accountAddMessages,
): FieldErrors<AccountField> | undefined {
  if (!isValidationFailure(error)) return undefined
  const rejected: FieldErrors<AccountField> = Object.assign(
    {},
    ...error.fieldErrors.map((fieldError) => messageOf(fieldError, messages)),
  )
  return Object.keys(rejected).length > 0 ? rejected : undefined
}

/** 장부에 같은 이름의 계좌가 이미 있어 거부됐다. */
export function isDuplicateName(error: Error): boolean {
  if (!isValidationFailure(error)) return false
  return error.fieldErrors.some(({ field, code }) => field === 'name' && code === 'DUPLICATE')
}

function isValidationFailure(error: Error): error is ApiError {
  return error instanceof ApiError && error.code === 'VALIDATION_FAILED'
}

function messageOf({ field, code }: FieldError, messages: AccountMessages): FieldErrors<AccountField> {
  const message = messageFor(field, code, messages)
  return message === undefined ? {} : { [field]: message }
}

function messageFor(field: string, code: string, messages: AccountMessages): string | undefined {
  switch (field) {
    case 'name':
      return nameMessage(code, messages)
    case 'type':
      return typeMessage(code, messages)
    case 'openingBalance':
      return amountMessage(code, messages)
    case 'openingDate':
      return dateMessage(code, messages)
  }
}

function nameMessage(code: string, messages: AccountMessages): string | undefined {
  switch (code) {
    case 'REQUIRED':
      return messages.nameRequired
    case 'TOO_LONG':
      return messages.nameTooLong
    case 'INVALID_FORMAT':
      return messages.nameUnusable
    case 'DUPLICATE':
      return messages.nameDuplicate
  }
}

function typeMessage(code: string, messages: AccountMessages): string | undefined {
  switch (code) {
    case 'REQUIRED':
    case 'INVALID_FORMAT':
      return messages.typeRequired
  }
}

function amountMessage(code: string, messages: AccountMessages): string | undefined {
  switch (code) {
    case 'REQUIRED':
    case 'INVALID_FORMAT':
      return messages.amountRequired
    case 'OUT_OF_RANGE':
      return amountTooLarge
  }
}

function dateMessage(code: string, messages: AccountMessages): string | undefined {
  switch (code) {
    case 'REQUIRED':
    case 'INVALID_FORMAT':
      return messages.dateRequired
    case 'OUT_OF_RANGE':
      return dateOutOfRange(today())
  }
}

/** 달력이 막으므로 서버가 거부한 때에만 나온다. 서버는 장부의 시간대로 판정한다. */
function dateOutOfRange(today: string): string {
  const { first, last } = selectableRange(today)
  return `${formatDate(first, today)}부터 ${formatDate(last, today)}까지 고를 수 있어요`
}
