import { today } from '../../components/calendarDate'
import type { FieldErrors } from '../../components/useFormFields'
import { hasUnusableCharacter, lengthOf, normalizeName } from '../../components/visibleText'
import type { AccountType, NewAccount } from './accounts'

/** 칸의 값. 오류를 보이는 칸의 이름은 보내는 값(NewAccount)과 같다. */
export interface AccountValues {
  name: string
  type: AccountType
  /** 부호를 뺀 시작 잔액이나 갚을 금액(원). 비었으면 없다. */
  openingBalance: number | undefined
  /** 시작 잔액이 음수다(마이너스 통장). 카드에서는 쓰지 않는다. */
  negative: boolean
  openingDate: string
}

export type AccountField = keyof NewAccount

/** 화면 위쪽부터 놓인 순서 */
export const accountFields: AccountField[] = ['name', 'type', 'openingBalance', 'openingDate']

// 서버가 같은 까닭으로 거부해도 쓰는 문구(화면설계서 G-02 입력값 오류)
export const nameRequired = '이름을 입력해 주세요.'
export const nameTooLong = '50자까지 쓸 수 있어요.'
export const nameUnusable = '쓸 수 없는 글자가 있어요. 모두 지우고 다시 써 주세요.'
export const amountRequired = '금액을 입력해 주세요. 없으면 0을 적어요.'
export const dateRequired = '기준일을 골라 주세요.'

export const ACCOUNT_NAME_MAX = 50

export function accountNameLength(name: string): number {
  return lengthOf(normalizeName(name))
}

/** 기준일의 처음 값은 기기의 오늘이다. */
export function newAccountValues(): AccountValues {
  return { name: '', type: 'BANK', openingBalance: 0, negative: false, openingDate: today() }
}

/** 칸마다 오류 문구. 맞는 칸은 없다. 금액의 최대는 금액 칸이, 기준일의 범위는 달력이 막는다. */
export function validateAccount({ name, openingBalance, openingDate }: AccountValues): FieldErrors<AccountField> {
  return {
    name: nameError(name),
    openingBalance: openingBalance === undefined ? amountRequired : undefined,
    openingDate: openingDate === '' ? dateRequired : undefined,
  }
}

/** 서버에 보낼 값. 검사에 맞은 값만 받는다. */
export function toNewAccount({ name, type, openingBalance, negative, openingDate }: AccountValues): NewAccount {
  const amount = openingBalance!
  const owed = type === 'CARD' || negative
  // 0에서 빼면 -0이 되지 않는다
  return { name: normalizeName(name), type, openingBalance: owed ? 0 - amount : amount, openingDate }
}

function nameError(value: string): string | undefined {
  const name = normalizeName(value)
  if (name === '') return nameRequired
  if (hasUnusableCharacter(name)) return nameUnusable
  if (accountNameLength(value) > ACCOUNT_NAME_MAX) return nameTooLong
}
