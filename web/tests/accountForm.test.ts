import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  accountAddMessages,
  accountNameLength,
  newAccountValues,
  toNewAccount,
  validateAccount,
} from '../src/features/accounts/accountForm'

const values = { name: '급여통장', type: 'BANK', openingBalance: 350000, negative: false, openingDate: '2026-11-26' } as const

describe('처음 값', () => {
  beforeEach(() => void vi.useFakeTimers({ toFake: ['Date'] }))
  afterEach(() => void vi.useRealTimers())

  it.each([
    ['자정 직전', new Date(2026, 10, 26, 23, 59, 59), '2026-11-26'],
    ['자정', new Date(2026, 10, 27, 0, 0, 0), '2026-11-27'],
    ['한 해의 마지막 날', new Date(2026, 11, 31, 23, 59, 59), '2026-12-31'],
    ['새해 첫날', new Date(2027, 0, 1, 0, 0, 0), '2027-01-01'],
    ['윤일', new Date(2028, 1, 29, 12, 0, 0), '2028-02-29'],
  ])('은행, 0원, 양수이고 기준일은 기기의 오늘이다: %s', (_, now, openingDate) => {
    vi.setSystemTime(now)
    expect(newAccountValues()).toEqual({ name: '', type: 'BANK', openingBalance: 0, negative: false, openingDate })
  })
})

describe('검사', () => {
  it('맞으면 오류가 없다', () => {
    expect(Object.values(validateAccount(values)).filter(Boolean)).toEqual([])
  })

  it.each([
    ['비었음', '', '이름을 입력해 주세요'],
    ['공백류뿐', ' \u{A0}\u{3000}', '이름을 입력해 주세요'],
    ['51자', '가'.repeat(51), '50자까지 쓸 수 있어요'],
    ['코드포인트로 센 51자', '\u{1F600}'.repeat(51), '50자까지 쓸 수 있어요'],
    ['보이지 않는 글자', '급여\u{200B}통장', '쓸 수 없는 글자가 있어요. 모두 지우고 다시 써 주세요.'],
    ['제어 문자', '급여\u{0007}통장', '쓸 수 없는 글자가 있어요. 모두 지우고 다시 써 주세요.'],
    ['쓸 수 없는 글자가 있는 51자', '\u{200B}' + '가'.repeat(50), '쓸 수 없는 글자가 있어요. 모두 지우고 다시 써 주세요.'],
  ])('이름이 %s이면 거부한다', (_, name, message) => {
    expect(validateAccount({ ...values, name }).name).toBe(message)
  })

  it.each([
    ['1자', '가'],
    ['50자', '가'.repeat(50)],
    ['앞뒤 공백을 뺀 50자', `\u{3000} ${'가'.repeat(50)} `],
    ['분해형 50자', '가'.normalize('NFD').repeat(50)],
    ['이모지 50자', '\u{1F600}'.repeat(50)],
  ])('이름이 %s이면 받는다', (_, name) => {
    expect(validateAccount({ ...values, name }).name).toBeUndefined()
  })

  it('금액이 비었으면 거부하고 0이면 받는다', () => {
    expect(validateAccount({ ...values, openingBalance: undefined }).openingBalance).toBe(
      '금액을 입력해 주세요. 없으면 0을 적어요.',
    )
    expect(validateAccount({ ...values, openingBalance: 0 }).openingBalance).toBeUndefined()
  })

  it('기준일이 비었으면 거부한다', () => {
    expect(validateAccount({ ...values, openingDate: '' }).openingDate).toBe('기준일을 골라 주세요')
  })

  it('이름의 글자 수는 앞뒤의 공백류를 빼고 조합형으로 센다', () => {
    expect(accountNameLength(`  ${'가'.normalize('NFD').repeat(41)}\u{A0}`)).toBe(41)
  })
})

describe('보낼 값', () => {
  it('이름은 앞뒤의 공백류를 지우고 조합형으로 맞춘 값이다', () => {
    expect(toNewAccount({ ...values, name: `\u{3000}${'급여통장'.normalize('NFD')} ` }).name).toBe('급여통장')
  })

  it.each([
    ['은행의 양수', 'BANK', 350000, false, 350000],
    ['은행의 음수', 'BANK', 350000, true, -350000],
    ['현금의 음수', 'CASH', 1, true, -1],
    ['카드는 늘 음수', 'CARD', 350000, false, -350000],
    ['카드에서는 부호를 보지 않는다', 'CARD', 350000, true, -350000],
    ['최대', 'CARD', 9_999_999_999, false, -9_999_999_999],
    ['0', 'BANK', 0, false, 0],
    ['음수로 고른 0', 'BANK', 0, true, 0],
    ['카드의 0', 'CARD', 0, false, 0],
  ] as const)('시작 잔액: %s', (_, type, openingBalance, negative, sent) => {
    const { openingBalance: result } = toNewAccount({ ...values, type, openingBalance, negative })
    expect(Object.is(result, sent)).toBe(true)
  })

  it('종류와 기준일은 그대로다', () => {
    expect(toNewAccount(values)).toEqual({
      name: '급여통장',
      type: 'BANK',
      openingBalance: 350000,
      openingDate: '2026-11-26',
    })
  })
})

describe('화면이 정한 문구', () => {
  // 첫 실행 안내(C-02)처럼 같은 검사를 다른 문구로 쓰는 화면
  const messages = {
    ...accountAddMessages,
    nameRequired: '계좌 이름을 입력해 주세요',
    nameTooLong: '50자까지 쓸 수 있어요',
    dateRequired: '기준일을 골라 주세요',
  }

  it.each([
    ['빈 이름', { name: '' }, 'name', '계좌 이름을 입력해 주세요'],
    ['51자', { name: '가'.repeat(51) }, 'name', '50자까지 쓸 수 있어요'],
    ['바꾸지 않은 문구', { name: '급여\u{200B}통장' }, 'name', '쓸 수 없는 글자가 있어요. 모두 지우고 다시 써 주세요.'],
    ['빈 금액', { openingBalance: undefined }, 'openingBalance', '금액을 입력해 주세요. 없으면 0을 적어요.'],
    ['빈 기준일', { openingDate: '' }, 'openingDate', '기준일을 골라 주세요'],
  ] as const)('%s', (_, changed, field, message) => {
    expect(validateAccount({ ...values, ...changed }, messages)[field]).toBe(message)
  })

  it('주지 않으면 계좌 추가(G-02)의 문구다', () => {
    expect(validateAccount({ ...values, name: '' }).name).toBe('이름을 입력해 주세요')
  })
})

describe('계좌 추가 칸 오류의 마침표(00-common 3.1)', () => {
  // 한 문장짜리에는 찍지 않고, 두 문장 이상이면 문장마다 찍는다
  it.each(Object.entries(accountAddMessages))('%s: %s', (_, message) => {
    const sentences = message.split('. ')
    if (sentences.length === 1) expect(message.endsWith('.')).toBe(false)
    else expect(message.endsWith('.')).toBe(true)
  })
})
