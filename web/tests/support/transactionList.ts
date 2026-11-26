import { http, HttpResponse } from 'msw'
import type { SetupServer } from 'msw/node'
import type { Backend } from './backend'
import { problem } from './problem'
import { savedOf } from './transactions'

/* 거래 목록(#15의 응답 계약)이 되는 가짜 서버와 목록에 오는 거래 */

type Listed = ReturnType<typeof savedOf>

interface Sums {
  income: number
  expense: number
}

let created = 0

/** 만든 순서대로 커지는 UUID v7 모양의 id */
export function nextId(): string {
  created += 1
  return `01900000-0000-7000-8000-${String(created).padStart(12, '0')}`
}

type Fields = Record<string, unknown>

/** 목록에 오는 지출 하나. #14의 만들기 응답과 같은 모양이다. `changes`는 서버가 정하는 값(상태 등)을 바꾼다. */
export function expenseOf(fields: Fields, changes: object = {}): Listed {
  return savedOf({ id: nextId(), type: 'EXPENSE', occurredTime: null, ...fields }, 'user-1', changes)
}

export function incomeOf(fields: Fields, changes: object = {}): Listed {
  return savedOf({ id: nextId(), type: 'INCOME', occurredTime: null, ...fields }, 'user-1', changes)
}

export function transferOf(fields: Fields, changes: object = {}): Listed {
  return savedOf({ id: nextId(), type: 'TRANSFER', occurredTime: null, ...fields }, 'user-1', changes)
}

/** P-205: 이체와 취소를 빼고 지출과 수입을 더한다. 지출은 양수다. */
export function sumsOf(items: Listed[]): Sums {
  const counted = items.filter(({ status }) => status !== 'CANCELED')
  const total = (type: string) =>
    counted.filter((item) => item.type === type).reduce((sum, item) => sum + Number(item.amount), 0)
  return { income: total('INCOME'), expense: total('EXPENSE') }
}

/** 화면이 보낸 목록 요청 하나 */
export interface ListRequest {
  ledgerId: string
  /** 토큰의 사용자. 토큰이 없거나 만료됐으면 없다. */
  user: string | undefined
  month: string | null
  limit: string | null
  cursor: string | null
  /** 받은 쿼리의 이름 */
  names: string[]
}

/** `items` 가운데 `start`부터 `limit`건을 한 쪽으로 준다. 합계와 그날 합계는 `sums`가 정한 값이 앞선다. */
export function pageOf(
  month: string,
  items: Listed[],
  start: number,
  limit: number,
  sums: { totals?: Sums; days?: Map<string, Sums> } = {},
) {
  const page = items.slice(start, start + limit)
  const end = start + page.length
  const dates = [...new Set(page.map((item) => String(item.occurredOn)))]
  return {
    items: page,
    nextCursor: end < items.length ? `${month}|${end}` : null,
    totals: start === 0 ? (sums.totals ?? sumsOf(items)) : null,
    days: dates.map((date) => ({
      date,
      ...(sums.days?.get(date) ?? sumsOf(items.filter((item) => item.occurredOn === date))),
    })),
  }
}

/** 거래 목록이 되는 가짜 서버. 달마다 거래를 서버의 순서대로 넣어 둔다. 넣지 않은 달은 거래가 없다. */
export function startTransactionList(server: SetupServer, backend: Backend) {
  const list = {
    /** 달(`YYYY-MM`)마다 서버가 주는 순서의 거래 */
    months: new Map<string, Listed[]>(),
    /** 달마다 정해 둔 합계. 없으면 거래로 센다. */
    totals: new Map<string, Sums>(),
    /** 날짜마다 정해 둔 그날 합계. 없으면 그날 거래로 센다. */
    days: new Map<string, Sums>(),
    /** 정해 두면 그 응답을 준다. */
    response: undefined as ((sent: ListRequest) => Response | Promise<Response> | undefined) | undefined,
    requests: [] as ListRequest[],
  }
  server.use(
    http.get('/api/v1/ledgers/:ledgerId/transactions', async ({ request, params }) => {
      const query = new URL(request.url).searchParams
      const sent: ListRequest = {
        ledgerId: String(params.ledgerId),
        user: backend.userOf(request),
        month: query.get('month'),
        limit: query.get('limit'),
        cursor: query.get('cursor'),
        names: [...query.keys()],
      }
      list.requests.push(sent)
      if (!sent.user) return problem(401, 'UNAUTHENTICATED')
      const answered = await list.response?.(sent)
      if (answered) return answered
      const month = sent.month ?? ''
      const start = sent.cursor === null ? 0 : Number(sent.cursor.split('|')[1])
      // 휴지통의 거래는 목록에 없다(#15)
      const items = (list.months.get(month) ?? []).filter(({ deletedAt }) => deletedAt === null)
      const body = pageOf(month, items, start, Number(sent.limit ?? 50), {
        totals: list.totals.get(month),
        days: list.days,
      })
      return HttpResponse.json(body)
    }),
  )
  return list
}

export type TransactionList = ReturnType<typeof startTransactionList>
