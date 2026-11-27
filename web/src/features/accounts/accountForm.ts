import type { FieldErrors } from '../../components/useFormFields'
import { today } from '../../lib/calendarDate'
import { hasUnusableCharacter, lengthOf, normalizeName } from '../../lib/visibleText'
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

/** 칸의 오류 문구. 서버가 같은 까닭으로 거부해도 쓴다. 계좌를 만드는 화면마다 다른 문구만 바꾼다. */
export interface AccountMessages {
  nameRequired: string
  nameTooLong: string
  nameUnusable: string
  /** 서버만 안다 */
  nameDuplicate: string
  /** 서버가 거부한 때만 나온다. 종류는 늘 하나가 골라져 있다. */
  typeRequired: string
  amountRequired: string
  dateRequired: string
}

/**
 * 계좌 추가(화면설계서 G-02 입력값 오류)의 문구. 한 문장짜리에는 마침표를 찍지 않고
 * 두 문장 이상이면 문장마다 찍는다(00-common 3.1, planner 결정 #102).
 */
export const accountAddMessages: AccountMessages = {
  nameRequired: '이름을 입력해 주세요',
  nameTooLong: '50자까지 쓸 수 있어요',
  nameUnusable: '쓸 수 없는 글자가 있어요. 모두 지우고 다시 써 주세요.',
  nameDuplicate: '같은 이름의 계좌가 있어요. 다른 이름을 써 주세요.',
  typeRequired: '종류를 골라 주세요',
  amountRequired: '금액을 입력해 주세요. 없으면 0을 적어요.',
  dateRequired: '기준일을 골라 주세요',
}

export const ACCOUNT_NAME_MAX = 50

export function accountNameLength(name: string): number {
  return lengthOf(normalizeName(name))
}

/** 기준일의 처음 값은 기기의 오늘이다. */
export function newAccountValues(): AccountValues {
  return { name: '', type: 'BANK', openingBalance: 0, negative: false, openingDate: today() }
}

/** 칸마다 오류 문구. 맞는 칸은 없다. 금액의 최대는 금액 칸이, 기준일의 범위는 달력이 막는다. */
export function validateAccount(
  { name, openingBalance, openingDate }: AccountValues,
  messages: AccountMessages = accountAddMessages,
): FieldErrors<AccountField> {
  return {
    name: nameError(name, messages),
    openingBalance: openingBalance === undefined ? messages.amountRequired : undefined,
    openingDate: openingDate === '' ? messages.dateRequired : undefined,
  }
}

/** 서버에 보낼 값. 검사에 맞은 값만 받는다. */
export function toNewAccount({ name, type, openingBalance, negative, openingDate }: AccountValues): NewAccount {
  const amount = openingBalance!
  const owed = type === 'CARD' || negative
  // 0에서 빼면 -0이 되지 않는다
  return { name: normalizeName(name), type, openingBalance: owed ? 0 - amount : amount, openingDate }
}

function nameError(value: string, messages: AccountMessages): string | undefined {
  const name = normalizeName(value)
  if (name === '') return messages.nameRequired
  if (hasUnusableCharacter(value)) return messages.nameUnusable
  if (accountNameLength(value) > ACCOUNT_NAME_MAX) return messages.nameTooLong
}
