import { ApiError } from '../../api/apiError'
import { request } from '../../api/request'
import { ledgerPath } from '../me/ledgerPath'

/* 월별 통계의 경로와 필드 이름(#16의 응답 계약, PR #334)은 이 파일에만 있다. */

/** 지출이 큰 최상위 카테고리 하나(하위 카테고리는 상위에 합쳐 온다) */
export interface TopExpense {
  categoryId: string
  /** 그 카테고리의 지출(원, 양수) */
  amount: number
}

/** 한 달의 통계. 계산은 서버가 한다(P-205). */
export interface MonthlyStats {
  income: number
  /** 지출은 양수로 온다. 환불이 더 큰 달은 음수 그대로다 */
  expense: number
  /** 차액(수입 − 지출) */
  net: number
  /** 금액이 큰 순(같으면 categoryId 순)으로 다섯 개까지. 0원 이하는 없고 미분류도 카테고리다. 거래가 없는 달은 비었다 */
  topExpenses: TopExpense[]
}

/** 서버가 주는 상위 카테고리의 최대 수(F-301, E-01 (6)) */
const TOP_EXPENSE_LIMIT = 5

/** 장부의 한 달(`YYYY-MM`) 통계. 약속과 다른 응답은 일부만 쓰지 않고 서버 오류로 본다. 실패하면 ApiError를 던진다. */
export async function fetchMonthlyStats(ledgerId: string, month: string): Promise<MonthlyStats> {
  const query = new URLSearchParams({ month })
  const body = await request<unknown>(`${ledgerPath(ledgerId, 'stats/monthly')}?${query}`)
  const stats = parseMonthlyStats(body, month)
  if (!stats) throw ApiError.unreadable()
  return stats
}

function parseMonthlyStats(body: unknown, month: string): MonthlyStats | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const { month: answered, income, expense, net, topExpenseCategories: top } = body as Record<string, unknown>
  if (answered !== month || ![income, expense, net].every(Number.isSafeInteger)) return undefined
  if (!Array.isArray(top) || top.length > TOP_EXPENSE_LIMIT || !top.every(isTopExpense)) return undefined
  return {
    income: income as number,
    expense: expense as number,
    net: net as number,
    topExpenses: top.map(({ categoryId, amount }) => ({ categoryId, amount })),
  }
}

function isTopExpense(value: unknown): value is TopExpense {
  if (typeof value !== 'object' || value === null) return false
  const { categoryId, amount } = value as Record<string, unknown>
  return typeof categoryId === 'string' && categoryId !== '' && Number.isSafeInteger(amount) && (amount as number) > 0
}
