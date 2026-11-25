import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../src/api/apiError'
import { rejectedFields } from '../src/features/accounts/accountRejection'

const rejected = (...fieldErrors: [field: string, code: string][]) =>
  ApiError.response(400, {
    code: 'VALIDATION_FAILED',
    fieldErrors: fieldErrors.map(([field, code]) => ({ field, code })),
  })

beforeEach(() => void vi.useFakeTimers({ toFake: ['Date'] }))
afterEach(() => void vi.useRealTimers())

describe('거부된 칸의 문구', () => {
  it.each([
    ['name', 'REQUIRED', '이름을 입력해 주세요.'],
    ['name', 'TOO_LONG', '50자까지 쓸 수 있어요.'],
    ['name', 'INVALID_FORMAT', '쓸 수 없는 글자가 있어요. 모두 지우고 다시 써 주세요.'],
    ['name', 'DUPLICATE', '같은 이름의 계좌가 있어요. 다른 이름을 써 주세요.'],
    ['type', 'REQUIRED', '종류를 골라 주세요.'],
    ['type', 'INVALID_FORMAT', '종류를 골라 주세요.'],
    ['openingBalance', 'REQUIRED', '금액을 입력해 주세요. 없으면 0을 적어요.'],
    ['openingBalance', 'INVALID_FORMAT', '금액을 입력해 주세요. 없으면 0을 적어요.'],
    ['openingBalance', 'OUT_OF_RANGE', '9,999,999,999원까지 입력할 수 있어요.'],
    ['openingDate', 'REQUIRED', '기준일을 골라 주세요.'],
    ['openingDate', 'INVALID_FORMAT', '기준일을 골라 주세요.'],
  ])('%s %s', (field, code, message) => {
    expect(rejectedFields(rejected([field, code]))).toEqual({ [field]: message })
  })

  it.each([
    ['보통 날', new Date(2026, 10, 20, 12), '2027년 11월 20일'],
    ['자정 직전', new Date(2026, 10, 20, 23, 59, 59), '2027년 11월 20일'],
    ['자정', new Date(2026, 10, 21, 0, 0, 0), '2027년 11월 21일'],
    ['말일', new Date(2026, 11, 31, 23, 59, 59), '2027년 12월 31일'],
    ['윤일', new Date(2028, 1, 29, 12), '2029년 2월 28일'],
  ])('기준일이 범위 밖이면 기기의 오늘로부터 1년 뒤까지를 알린다: %s', (_, now, last) => {
    vi.setSystemTime(now)
    expect(rejectedFields(rejected(['openingDate', 'OUT_OF_RANGE']))).toEqual({
      openingDate: `2000년 1월 1일부터 ${last}까지 고를 수 있어요.`,
    })
  })

  it('여러 칸이 오면 모두 준다. 모르는 것은 뺀다', () => {
    expect(
      rejectedFields(rejected(['openingDate', 'REQUIRED'], ['memo', 'TOO_LONG'], ['name', 'TOO_LONG'], ['type', 'NEW'])),
    ).toEqual({ openingDate: '기준일을 골라 주세요.', name: '50자까지 쓸 수 있어요.' })
  })

  it.each([
    ['모르는 칸', rejected(['memo', 'TOO_LONG'])],
    ['빈 칸 이름', rejected(['', 'REQUIRED'])],
    ['모르는 code', rejected(['name', 'SOMETHING_NEW'])],
    ['그 칸에 없는 code', rejected(['type', 'TOO_LONG'])],
    ['객체에 원래 있는 이름', rejected(['constructor', 'REQUIRED'], ['name', 'toString'])],
    ['칸이 없음', rejected()],
    ['다른 code', ApiError.response(409, { code: 'INVALID_STATE', fieldErrors: [{ field: 'name', code: 'DUPLICATE' }] })],
    ['서버 오류', ApiError.response(500)],
    ['지연', ApiError.timeout()],
    ['연결', ApiError.connection()],
    ['다른 예외', new Error('아님')],
  ])('%s이면 없다', (_, error) => {
    expect(rejectedFields(error)).toBeUndefined()
  })
})
