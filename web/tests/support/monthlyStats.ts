import { http, HttpResponse } from 'msw'
import type { SetupServer } from 'msw/node'
import type { Backend } from './backend'
import { problem } from './problem'

/** 서버가 주는 월별 통계 하나(#16의 응답 계약, PR #334) */
export interface MonthlyStatsBody {
  month: string
  income: number
  expense: number
  net: number
  topExpenseCategories: { categoryId: string; amount: number }[]
}

interface StatsValues {
  income?: number
  expense?: number
  /** 지출이 큰 최상위 카테고리 [id, 금액]. 서버가 주는 순서(금액이 큰 순)로 적는다 */
  top?: [categoryId: string, amount: number][]
}

/** 그 달의 월별 통계. 차액은 서버처럼 수입 − 지출이다. 아무것도 주지 않으면 거래가 없는 달이다. */
export function statsOf(month: string, { income = 0, expense = 0, top = [] }: StatsValues = {}): MonthlyStatsBody {
  return {
    month,
    income,
    expense,
    net: income - expense,
    topExpenseCategories: top.map(([categoryId, amount]) => ({ categoryId, amount })),
  }
}

/** 받은 요청 */
export interface StatsRequest {
  ledgerId: string
  month: string | null
  /** 쿼리의 이름(보낸 순서) */
  names: string[]
}

/**
 * 월별 통계 API(`GET /ledgers/{ledgerId}/stats/monthly?month=YYYY-MM`)가 되는 가짜 서버. 달마다 `months`에 넣은 통계를 주고,
 * 넣지 않은 달은 거래가 없는 달(0원과 빈 목록)이다. `response`를 정하면 그 응답을 준다.
 */
export function startMonthlyStats(server: SetupServer, backend: Backend) {
  const stats = {
    months: new Map<string, MonthlyStatsBody>(),
    response: undefined as ((month: string | null) => Response | Promise<Response>) | undefined,
    requests: [] as StatsRequest[],
  }
  server.use(
    http.get('/api/v1/ledgers/:ledgerId/stats/monthly', ({ request, params }) => {
      const query = new URL(request.url).searchParams
      const month = query.get('month')
      stats.requests.push({ ledgerId: String(params.ledgerId), month, names: [...query.keys()] })
      if (!backend.userOf(request)) return problem(401, 'UNAUTHENTICATED')
      if (stats.response) return stats.response(month)
      return HttpResponse.json(stats.months.get(month ?? '') ?? statsOf(month ?? ''))
    }),
  )
  return stats
}

export type MonthlyStatsServer = ReturnType<typeof startMonthlyStats>
