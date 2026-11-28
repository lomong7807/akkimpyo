import type { FieldErrors } from '../../components/useFormFields'
import { today } from '../../lib/calendarDate'
import { hasUnusableCharacter, lengthOf, normalizeName } from '../../lib/visibleText'
import type { EditableAccount } from './accountEdit'
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

/**
 * 저장된 계좌를 칸의 값으로(G-02 수정 모드). 칸은 부호를 뺀 크기를 받는다. 은행·현금의 음수는 부호를 -로 두고,
 * 카드는 저장된 음수(갚을 금액)를 양수로 바꿔 채운다(F-503).
 */
export function savedAccountValues({ name, type, openingBalance, openingDate }: EditableAccount): AccountValues {
  return {
    name,
    type,
    openingBalance: Math.abs(openingBalance),
    negative: type !== 'CARD' && openingBalance < 0,
    openingDate,
  }
}

/**
 * 고친 계좌에 보낼 값. 검사에 맞은 값만 받는다. 종류와 금액 칸이 연 때 그대로면 저장된 시작 잔액을 그대로 보낸다. 칸으로는 나타낼 수
 * 없는 값(API로 만든 양수의 카드 시작 잔액)이 이름만 고쳐도 뒤집히지 않게 한다(planner #243 P2).
 */
export function toAccountUpdate(values: AccountValues, opened: EditableAccount): NewAccount {
  const update = toNewAccount(values)
  const before = savedAccountValues(opened)
  const amountKept =
    values.type === before.type && values.openingBalance === before.openingBalance && values.negative === before.negative
  return amountKept ? { ...update, openingBalance: opened.openingBalance } : update
}

/** 보낼 값이 저장된 계좌와 같다. 칸의 글자가 달라도(앞뒤 공백, 0원의 부호) 바꾼 것이 없다. */
export function isSameAccount(update: NewAccount, saved: EditableAccount): boolean {
  return (
    update.name === saved.name &&
    update.type === saved.type &&
    update.openingBalance === saved.openingBalance &&
    update.openingDate === saved.openingDate
  )
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
