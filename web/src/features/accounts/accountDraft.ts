import { isDate } from '../../lib/calendarDate'
import type { AccountValues } from './accountForm'
import { accountTypes } from './accounts'

/** 계좌 추가(G-02)·첫 계좌(C-02)의 쓰던 값(#234 C2). 기기 저장소의 값은 믿지 않고 모양을 다시 본다. */
export function accountValuesOf(values: unknown): AccountValues | undefined {
  if (typeof values !== 'object' || values === null) return undefined
  const { name, type, openingBalance, negative, openingDate } = values as Record<keyof AccountValues, unknown>
  if (typeof name !== 'string' || !accountTypes.includes(type as AccountValues['type'])) return undefined
  if (openingBalance !== undefined && !(Number.isSafeInteger(openingBalance) && (openingBalance as number) >= 0)) {
    return undefined
  }
  if (typeof negative !== 'boolean' || typeof openingDate !== 'string' || !isDate(openingDate)) return undefined
  return {
    name,
    type: type as AccountValues['type'],
    openingBalance: openingBalance as number | undefined,
    negative,
    openingDate,
  }
}
