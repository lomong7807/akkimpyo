import type { FieldErrors } from '../../components/useFormFields'
import { today } from '../../lib/calendarDate'
import { currentTime, isValidTime, normalizeTime } from '../../lib/timeText'
import { hasUnusableCharacter, lengthOf, trimSpaces } from '../../lib/visibleText'
import type {
  NewTransaction,
  TransactionContent,
  TransactionDetail,
  TransactionType,
  TransactionUpdate,
} from './transactions'

/** 칸의 값. 오류를 보이는 칸은 화면 위쪽부터 transactionFields의 순서다. */
export interface TransactionValues {
  type: TransactionType
  /** 원 단위. 비었으면 없다. */
  amount: number | undefined
  /** 가맹점/내용. 쓴 그대로다. */
  payee: string
  /** 고른 카테고리. 빈 글자는 미분류다. */
  categoryId: string
  /** 지출·수입의 계좌, 이체의 보내는 계좌. 사용자가 고르지 않았으면 빈 글자이고 화면이 기본 계좌를 쓴다. */
  accountId: string
  /** 이체의 받는 계좌 */
  toAccountId: string
  /** `YYYY-MM-DD` */
  occurredOn: string
  /** 칸의 글자. 비었으면 시각이 없다. */
  occurredTime: string
  memo: string
}

export type TransactionField = Exclude<keyof TransactionValues, 'type'>

/** 화면 위쪽부터 놓인 순서. 저장할 때 이 순서로 첫 오류 칸에 초점을 둔다. */
export const transactionFields: TransactionField[] = [
  'amount',
  'payee',
  'categoryId',
  'accountId',
  'toAccountId',
  'occurredOn',
  'occurredTime',
  'memo',
]

/** "더 보기" 아래에 접혀 있는 칸 */
export const foldedFields: readonly TransactionField[] = ['occurredTime', 'memo']

export const PAYEE_MAX = 100
export const MEMO_MAX = 500

// 화면설계서 D-04 예외 처리의 입력값 오류. 서버가 같은 까닭으로 거부해도 쓴다
export const amountOutOfRange = '1원부터 9,999,999,999원까지 입력할 수 있어요'
export const payeeTooLong = '100자까지 쓸 수 있어요'
export const unusableCharacter = '쓸 수 없는 글자가 있어요. 모두 지우고 다시 써 주세요.'
export const accountRequired = '계좌를 골라 주세요'
export const toAccountRequired = '받는 계좌를 골라 주세요'
export const sameAccount = '같은 계좌로는 이체할 수 없어요'
export const dateRequired = '날짜를 골라 주세요'
export const timeInvalid = '시각은 00:00부터 23:59까지 입력할 수 있어요'
export const memoTooLong = '500자까지 쓸 수 있어요'

/** 새 입력의 처음 값(D-04 칸별 기본값). 날짜와 시각은 기기의 지금이고, 계좌는 화면이 기본 계좌로 채운다. */
export function newTransactionValues(): TransactionValues {
  return {
    type: 'EXPENSE',
    amount: undefined,
    payee: '',
    categoryId: '',
    accountId: '',
    toAccountId: '',
    occurredOn: today(),
    occurredTime: currentTime(),
    memo: '',
  }
}

/** 서버가 검사하고 저장하는 가맹점/내용. 앞뒤 공백류를 지우고 조합형으로 맞춘다(P-214). */
export function normalizePayee(payee: string): string {
  return trimSpaces(payee).normalize('NFC')
}

/** 서버와 같이 조합형으로 맞춘 코드포인트를 센다. 메모는 공백을 지우지 않는다(P-214). */
export function memoLength(memo: string): number {
  return lengthOf(unifyLineBreaks(memo).normalize('NFC'))
}

/**
 * 서버가 메모를 검사하기 전에 하듯 `\r\n`과 `\r`을 `\n`으로 바꾼다(P-214). 검사에만 쓰고 보내는 값은 바꾸지 않는다(서버가
 * 바꾼다). 여러 줄 칸의 값에는 `\r`이 없어 화면에서는 바뀌는 것이 없다.
 */
function unifyLineBreaks(memo: string): string {
  return memo.replace(/\r\n?/g, '\n')
}

export function payeeLength(payee: string): number {
  return lengthOf(normalizePayee(payee))
}

/**
 * 칸마다 오류 문구. 맞는 칸은 없다. `accountId`는 기본 계좌까지 채운 값으로 본다.
 * 금액의 최대 자릿수는 금액 칸이, 날짜의 범위는 달력이 막는다.
 */
export function validateTransaction(values: TransactionValues): FieldErrors<TransactionField> {
  const transfer = values.type === 'TRANSFER'
  return {
    amount: values.amount === undefined || values.amount === 0 ? amountOutOfRange : undefined,
    payee: transfer ? undefined : payeeError(values.payee),
    accountId: values.accountId === '' ? accountRequired : undefined,
    toAccountId: transfer ? toAccountError(values) : undefined,
    occurredOn: values.occurredOn === '' ? dateRequired : undefined,
    occurredTime: values.occurredTime === '' || isValidTime(normalizeTime(values.occurredTime)) ? undefined : timeInvalid,
    memo: memoError(values.memo),
  }
}

// 보이지 않는 글자도 글자 수에 들어가므로 쓸 수 없는 글자의 문구를 먼저 보인다(00-common 4.4)
function payeeError(payee: string): string | undefined {
  if (hasUnusableCharacter(payee)) return unusableCharacter
  if (payeeLength(payee) > PAYEE_MAX) return payeeTooLong
}

/** 메모는 줄바꿈(U+000A)을 더 받는다(P-214). 같은 문구를 미리 보인다(00-common 4.4, frontend 결정 #220). */
function memoError(memo: string): string | undefined {
  if (hasUnusableCharacter(unifyLineBreaks(memo), { allowLineFeed: true })) return unusableCharacter
  if (memoLength(memo) > MEMO_MAX) return memoTooLong
}

function toAccountError({ accountId, toAccountId }: TransactionValues): string | undefined {
  if (toAccountId === '') return toAccountRequired
  if (toAccountId === accountId) return sameAccount
}

/**
 * 유형을 바꿀 때 함께 바꾸는 칸(D-04 (2)). 금액, 날짜, 시각, 메모, 가맹점/내용은 그대로 둔다.
 * 계좌 칸 하나가 지출·수입의 계좌와 이체의 보내는 계좌를 함께 맡아 서로 옮겨 간다. 이체로 바꾸면 받는 계좌는 빈다.
 * 카테고리는 지출과 수입의 구분이 달라 새 유형과 구분이 다르면 비운다(`categoryKind`는 고른 카테고리의 구분).
 */
export function typeChange(
  values: TransactionValues,
  type: TransactionType,
  categoryKind: (categoryId: string) => TransactionType | undefined,
): Partial<TransactionValues> {
  const change: Partial<TransactionValues> = { type }
  if (type === 'TRANSFER') change.toAccountId = ''
  else if (values.categoryId !== '' && categoryKind(values.categoryId) !== type) change.categoryId = ''
  return change
}

/**
 * 수정(D-04)의 처음 값. 저장된 거래의 값이고, 없는 값(가맹점, 시각, 메모)은 빈 칸이다. 이체의 보내는 계좌는 계좌 칸이 맡는다.
 * 서버는 미분류를 그 장부의 미분류 카테고리 id로 주므로(#15) 그 id면 빈 칸(미분류)으로 연다. `isUncategorized`는 그 판단이다.
 */
export function savedTransactionValues(
  transaction: TransactionDetail,
  isUncategorized: (categoryId: string) => boolean,
): TransactionValues {
  const shared = {
    type: transaction.type,
    amount: transaction.amount,
    occurredOn: transaction.occurredOn,
    occurredTime: transaction.occurredTime ?? '',
    memo: transaction.memo ?? '',
  }
  if (transaction.type === 'TRANSFER') {
    const { fromAccountId, toAccountId } = transaction
    return { ...shared, payee: '', categoryId: '', accountId: fromAccountId, toAccountId }
  }
  const { categoryId, accountId, payee } = transaction
  return {
    ...shared,
    payee: payee ?? '',
    categoryId: isUncategorized(categoryId) ? '' : categoryId,
    accountId,
    toAccountId: '',
  }
}

/** 새 거래로 보낼 값. 검사에 맞은 값과 기본 계좌까지 채운 계좌만 받는다. */
export function toNewTransaction(values: TransactionValues, id: string): NewTransaction {
  return { id, ...toTransactionContent(values) }
}

/**
 * 두 값을 보내면 서버에 같은 내용이 되는지. 칸의 글자가 달라도 보낼 값이 같으면(가맹점의 앞뒤 공백 등) 같다.
 * 수정에서 바꾼 것이 없으면 보내지 않는 데 쓴다. 둘 다 검사에 맞은 값이어야 한다.
 */
export function hasSameContent(a: TransactionValues, b: TransactionValues): boolean {
  return JSON.stringify(toTransactionContent(a)) === JSON.stringify(toTransactionContent(b))
}

/** 수정으로 보낼 값(#36). `version`은 화면이 연 때의 거래의 것이다. 받는 값은 toNewTransaction과 같다. */
export function toTransactionUpdate(values: TransactionValues, version: number): TransactionUpdate {
  return { ...toTransactionContent(values), version }
}

/**
 * 거래에 넣을 값. 서버가 저장할 모양으로 맞춘다(가맹점은 앞뒤 공백을 지우고, 글자는 조합형, 빈 칸은 null).
 * 날짜와 시각은 시간대 변환 없이 그대로 보낸다.
 */
function toTransactionContent(values: TransactionValues): TransactionContent {
  const occurredTime = values.occurredTime === '' ? null : normalizeTime(values.occurredTime)
  const memo = values.memo === '' ? null : values.memo.normalize('NFC')
  const amount = values.amount!
  if (values.type === 'TRANSFER') {
    return {
      type: 'TRANSFER',
      occurredOn: values.occurredOn,
      occurredTime,
      fromAccountId: values.accountId,
      toAccountId: values.toAccountId,
      amount,
      memo,
    }
  }
  const payee = normalizePayee(values.payee)
  return {
    type: values.type,
    occurredOn: values.occurredOn,
    occurredTime,
    accountId: values.accountId,
    categoryId: values.categoryId === '' ? null : values.categoryId,
    amount,
    payee: payee === '' ? null : payee,
    memo,
  }
}
