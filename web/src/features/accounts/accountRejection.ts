import { ApiError, type FieldError } from '../../api/apiError'
import { amountTooLarge } from '../../components/AmountField'
import { formatDate, selectableRange, today } from '../../components/calendarDate'
import type { FieldErrors } from '../../components/useFormFields'
import { amountRequired, dateRequired, nameRequired, nameTooLong, nameUnusable, type AccountField } from './accountForm'

/* 계좌 추가가 거부된 칸의 code(#13의 응답 계약)는 이 파일에만 있다. 칸의 이름은 보내는 값(NewAccount)과 같다. */

/** 서버가 거부한 칸의 문구. 아는 칸과 code가 하나도 없으면 없다. */
export function rejectedFields(error: Error): FieldErrors<AccountField> | undefined {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_FAILED') return undefined
  const rejected: FieldErrors<AccountField> = Object.assign({}, ...error.fieldErrors.map(messageOf))
  return Object.keys(rejected).length > 0 ? rejected : undefined
}

function messageOf({ field, code }: FieldError): FieldErrors<AccountField> {
  const message = messageFor(field, code)
  return message === undefined ? {} : { [field]: message }
}

function messageFor(field: string, code: string): string | undefined {
  switch (field) {
    case 'name':
      return nameMessage(code)
    case 'type':
      return typeMessage(code)
    case 'openingBalance':
      return amountMessage(code)
    case 'openingDate':
      return dateMessage(code)
  }
}

function nameMessage(code: string): string | undefined {
  switch (code) {
    case 'REQUIRED':
      return nameRequired
    case 'TOO_LONG':
      return nameTooLong
    case 'INVALID_FORMAT':
      return nameUnusable
    case 'DUPLICATE':
      return '같은 이름의 계좌가 있어요. 다른 이름을 써 주세요.'
  }
}

function typeMessage(code: string): string | undefined {
  switch (code) {
    case 'REQUIRED':
    case 'INVALID_FORMAT':
      return '종류를 골라 주세요.'
  }
}

function amountMessage(code: string): string | undefined {
  switch (code) {
    case 'REQUIRED':
    case 'INVALID_FORMAT':
      return amountRequired
    case 'OUT_OF_RANGE':
      return amountTooLarge
  }
}

function dateMessage(code: string): string | undefined {
  switch (code) {
    case 'REQUIRED':
    case 'INVALID_FORMAT':
      return dateRequired
    case 'OUT_OF_RANGE':
      return dateOutOfRange(today())
  }
}

/** 달력이 막으므로 서버가 거부한 때에만 나온다. 서버는 장부의 시간대로 판정한다. */
function dateOutOfRange(today: string): string {
  const { first, last } = selectableRange(today)
  return `${formatDate(first, today)}부터 ${formatDate(last, today)}까지 고를 수 있어요.`
}
