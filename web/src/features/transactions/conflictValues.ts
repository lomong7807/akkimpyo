import { formatDate } from '../../lib/calendarDate'
import { wallTimeOf } from '../../lib/clock'
import { normalizeTime } from '../../lib/timeText'
import type { NameBook } from './listedText'
import { normalizePayee, transactionFields, type TransactionValues } from './transactionForm'
import type { TransactionType } from './transactions'

/*
 * 수정 충돌 안내(N-04 (1)~(3), F-909)와 같은 거래를 다시 보낸 결과의 선택 판(ADR 006 결정 3)이 보이는 값.
 * 두 값이 다른지는 서버에 갈 값으로 본다(가맹점의 앞뒤 공백, 조합형 등은 같은 값). 수정에서 바꾼 것이 없는지 보는 것과 같다.
 */

/** 값이 없는 칸(N-04 (2)) */
export const NONE = '(없음)'

const UNCATEGORIZED = '미분류'
const typeNames = { EXPENSE: '지출', INCOME: '수입', TRANSFER: '이체' } as const
/** D-04 계좌 칸의 이름(TransactionFields와 같다) */
const accountNames = { EXPENSE: '계좌', INCOME: '들어온 계좌', TRANSFER: '보내는 계좌' } as const

type CompareField = 'type' | (typeof transactionFields)[number]

/** N-04 (2)의 순서. 유형은 선택 판에서 유형이 다를 때만 다르다(수정은 유형을 바꿀 수 없다, P-213). */
const compareOrder: CompareField[] = [
  'type',
  'amount',
  'occurredOn',
  'occurredTime',
  'accountId',
  'toAccountId',
  'categoryId',
  'payee',
  'memo',
]

const fieldNames: Record<Exclude<CompareField, 'accountId'>, string> = {
  type: '유형',
  amount: '금액',
  occurredOn: '날짜',
  occurredTime: '시각',
  toAccountId: '받는 계좌',
  categoryId: '카테고리',
  payee: '가맹점/내용',
  memo: '메모',
}

/** 비교 줄의 한 값. 금액은 그 거래의 유형으로 색과 부호를 정한다(00-common 2.2). */
export type CompareValue = { kind: 'text'; text: string } | { kind: 'amount'; type: TransactionType; value: number }

export interface CompareRow {
  field: CompareField
  /** 항목 이름. 칸의 이름과 같다 */
  name: string
  latest: CompareValue
  mine: CompareValue
}

/**
 * 두 값이 다른 항목만 N-04 (2)의 순서로 준다. `latest`는 최신 내용(선택 판은 저장된 내용), `mine`은 내 입력이다.
 * 둘 다 검사에 맞은 값이어야 한다. `today`는 날짜를 보일 때의 기준(올해면 연도를 쓰지 않는다)이다.
 */
export function compareRows(
  latest: TransactionValues,
  mine: TransactionValues,
  names: NameBook,
  today: string,
): CompareRow[] {
  return compareOrder
    .filter((field) => contentOf(latest, field) !== contentOf(mine, field))
    .map((field) => ({
      field,
      name: field === 'accountId' ? accountNameOf(latest.type, mine.type) : fieldNames[field],
      latest: shownOf(latest, field, names, today),
      mine: shownOf(mine, field, names, today),
    }))
}

/**
 * "내 입력 다시 적용"(F-909, ADR 006 결정 5): 최신 내용 위에 내가 바꾼 칸(연 때의 값과 달라진 칸)만 얹는다.
 * 얹는 값은 내가 쓴 글자 그대로다. `opened`는 고치기 시작한 때의 값이다. 이 기기에 남겼다 채운 입력이면 남길 때 함께 남긴
 * 연 때의 값이다(#266). 다시 연 때 받은 값을 주면 그사이 다른 기기가 고친 칸도 내가 바꾼 칸으로 본다.
 */
export function reapplyMine(
  opened: TransactionValues,
  mine: TransactionValues,
  latest: TransactionValues,
): TransactionValues {
  const merged = { ...latest }
  for (const field of transactionFields) {
    if (contentOf(opened, field) !== contentOf(mine, field)) Object.assign(merged, { [field]: mine[field] })
  }
  return merged
}

/**
 * N-04 (1)의 보조 글자. 받은 최신 거래를 고친 시각(서버가 기록한 UTC)을 기기의 시간대로 보인다. 오늘이면 시각만,
 * 아니면 날짜와 시각이다(00-common 3.2). `today`는 기기의 오늘이다.
 */
export function updatedTextOf(updatedAt: string, today: string): string {
  const { date, time } = wallTimeOf(Date.parse(updatedAt))
  const when = date === today ? time : `${formatDate(date, today)} ${time}`
  return `${when}에 고친 내용이 최신이에요`
}

/** 두 유형이 같으면 그 유형의 계좌 칸 이름, 다르면 "계좌" */
function accountNameOf(latest: TransactionType, mine: TransactionType): string {
  return latest === mine ? accountNames[latest] : accountNames.EXPENSE
}

/** 서버에 갈 값(transactionForm의 toTransactionContent와 같은 다듬기). 그 유형에 없는 칸은 null이다. 미분류는 빈 글자다. */
function contentOf(values: TransactionValues, field: CompareField): string | number | null {
  const transfer = values.type === 'TRANSFER'
  switch (field) {
    case 'type':
      return values.type
    case 'amount':
      return values.amount ?? null
    case 'occurredOn':
    case 'accountId':
      return values[field]
    case 'occurredTime':
      return values.occurredTime === '' ? null : normalizeTime(values.occurredTime)
    case 'toAccountId':
      return transfer ? values.toAccountId : null
    case 'categoryId':
      return transfer ? null : values.categoryId
    case 'payee': {
      const payee = transfer ? '' : normalizePayee(values.payee)
      return payee === '' ? null : payee
    }
    case 'memo':
      return values.memo === '' ? null : values.memo.normalize('NFC')
  }
}

function shownOf(values: TransactionValues, field: CompareField, names: NameBook, today: string): CompareValue {
  if (field === 'amount') return { kind: 'amount', type: values.type, value: values.amount ?? 0 }
  return { kind: 'text', text: textOf(values, field, names, today) }
}

function textOf(values: TransactionValues, field: Exclude<CompareField, 'amount'>, names: NameBook, today: string): string {
  const content = contentOf(values, field)
  if (field === 'type') return typeNames[values.type]
  if (content === null) return NONE
  switch (field) {
    case 'occurredOn':
      return formatDate(values.occurredOn, today)
    case 'accountId':
    case 'toAccountId':
      return names.account(String(content)) ?? ''
    case 'categoryId':
      return content === '' ? UNCATEGORIZED : (names.categoryWithParent(String(content)) ?? '')
    default:
      return String(content)
  }
}
