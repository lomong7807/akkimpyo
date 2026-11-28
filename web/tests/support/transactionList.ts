import { http, HttpResponse } from 'msw'
import type { SetupServer } from 'msw/node'
import { now } from '../../src/lib/clock'
import type { Backend } from './backend'
import { SEOUL } from './clock'
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

/** 기기에 남긴 최근 한 달(#238)의 모양. 저장 범위는 기본 2026-10-27 ~ 2026-11-26이다 */
export function lastMonthCopyOf(items: object[], from = '2026-10-27', to = '2026-11-26') {
  const dates = [...new Set(items.map((item) => (item as { occurredOn: string }).occurredOn))]
  return {
    from,
    to,
    items,
    days: dates.map((date) => ({ date, income: 0, expense: 0 })),
    months: [
      { month: '2026-10', totals: { income: 0, expense: 0 } },
      { month: '2026-11', totals: { income: 0, expense: 0 } },
    ],
    truncated: false,
  }
}

/** P-205: 이체와 취소를 빼고 지출과 수입을 더한다. 지출은 양수이고 환불·돌려받음은 지출에서 뺀다(서버 #8, #102). */
export function sumsOf(items: Listed[]): Sums {
  const counted = items.filter(({ status }) => status !== 'CANCELED')
  const signed = (item: Listed) => ((item as { refundKind?: unknown }).refundKind ? -1 : 1) * Number(item.amount)
  const total = (type: string) => counted.filter((item) => item.type === type).reduce((sum, item) => sum + signed(item), 0)
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

/** 화면이 보낸 하루 모드의 목록 요청 하나(`date=YYYY-MM-DD`) */
export interface DayRequest {
  ledgerId: string
  user: string | undefined
  date: string
  limit: string | null
  cursor: string | null
  names: string[]
}

/**
 * `items` 가운데 `start`부터 `limit`건을 한 쪽으로 준다. 합계와 그날 합계는 `sums`가 정한 값이 앞선다.
 * `month`가 null이면 장부 전체의 쪽이라 합계(totals)가 없다(#15).
 */
export function pageOf(
  month: string | null,
  items: Listed[],
  start: number,
  limit: number,
  sums: { totals?: Sums; days?: Map<string, Sums> } = {},
) {
  const page = items.slice(start, start + limit)
  const end = start + page.length
  const dates = [...new Set(page.map((item) => String(item.occurredOn)))]
  const firstTotals = month === null ? null : (sums.totals ?? sumsOf(items))
  return {
    items: page,
    nextCursor: end < items.length ? `${month ?? 'all'}|${end}` : null,
    totals: start === 0 ? firstTotals : null,
    days: dates.map((date) => ({
      date,
      ...(sums.days?.get(date) ?? sumsOf(items.filter((item) => item.occurredOn === date))),
    })),
  }
}

/** 장부 시간대(서비스 시간대 Asia/Seoul)의 오늘. 테스트가 정한 기기의 지금(src/lib/clock)으로 센다. */
function ledgerToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SEOUL, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    now(),
  )
}

/** 서버의 순서(#15): 날짜 역순, 같은 날은 시각 있는 것이 시각 역순으로 먼저, 같으면 id 역순 */
function byServerOrder(a: Listed, b: Listed): number {
  const [dateA, dateB] = [String(a.occurredOn), String(b.occurredOn)]
  if (dateA !== dateB) return dateA < dateB ? 1 : -1
  const [timeA, timeB] = [a.occurredTime as string | null, b.occurredTime as string | null]
  if (timeA !== timeB) {
    if (timeA === null) return 1
    if (timeB === null) return -1
    return timeA < timeB ? 1 : -1
  }
  return String(a.id) < String(b.id) ? 1 : -1
}

/**
 * 거래 목록이 되는 가짜 서버. 달마다 거래를 서버의 순서대로 넣어 둔다. 넣지 않은 달은 거래가 없다.
 * 달 없이 부르면(홈의 최근 거래) 넣어 둔 모든 달의 거래를 서버의 순서로 준다. 장부 시간대의 오늘보다 뒤의 날짜는 빠진다
 * (#15, planner 결정 2026-11-26).
 */
export function startTransactionList(server: SetupServer, backend: Backend) {
  /** 하루 모드(`date=YYYY-MM-DD`, #15). 넣어 둔 모든 달에서 그날의 거래를 서버의 순서로 준다. 합계(totals)는 그날 합계다 */
  function dayPage(sent: DayRequest) {
    const start = sent.cursor === null ? 0 : Number(sent.cursor.split('|')[1])
    const items = [...list.months.values()]
      .flat()
      .filter(({ occurredOn, deletedAt }) => occurredOn === sent.date && deletedAt === null)
      .sort(byServerOrder)
    return pageOf(sent.date, items, start, Number(sent.limit ?? 50), {
      totals: list.days.get(sent.date),
      days: list.days,
    })
  }
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
    /** 정해 두면 하루 모드 요청에 그 응답을 준다. */
    dayResponse: undefined as ((sent: DayRequest) => Response | Promise<Response> | undefined) | undefined,
    /** 하루 모드 요청. 달·장부 전체 요청(requests)과 따로 센다 */
    dayRequests: [] as DayRequest[],
  }
  server.use(
    http.get('/api/v1/ledgers/:ledgerId/transactions', async ({ request, params }) => {
      const query = new URL(request.url).searchParams
      const date = query.get('date')
      if (date !== null) {
        const day: DayRequest = {
          ledgerId: String(params.ledgerId),
          user: backend.userOf(request),
          date,
          limit: query.get('limit'),
          cursor: query.get('cursor'),
          names: [...query.keys()],
        }
        list.dayRequests.push(day)
        if (!day.user) return problem(401, 'UNAUTHENTICATED')
        return (await list.dayResponse?.(day)) ?? HttpResponse.json(dayPage(day))
      }
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
      const { month } = sent
      const start = sent.cursor === null ? 0 : Number(sent.cursor.split('|')[1])
      const source =
        month === null
          ? [...list.months.values()]
              .flat()
              .filter(({ occurredOn }) => String(occurredOn) <= ledgerToday())
              .sort(byServerOrder)
          : (list.months.get(month) ?? [])
      // 휴지통의 거래는 목록에 없다(#15)
      const items = source.filter(({ deletedAt }) => deletedAt === null)
      const body = pageOf(month, items, start, Number(sent.limit ?? 50), {
        totals: month === null ? undefined : list.totals.get(month),
        days: list.days,
      })
      return HttpResponse.json(body)
    }),
  )
  return list
}

export type TransactionList = ReturnType<typeof startTransactionList>

/** 화면이 보낸 달력용 날짜별 합계 요청 하나 */
export interface DailyRequest {
  ledgerId: string
  user: string | undefined
  month: string | null
  names: string[]
}

/**
 * 달력용 날짜별 합계(`GET .../stats/daily?month=YYYY-MM`, #66의 응답 계약)가 되는 가짜 서버. 거래 목록의 가짜 서버(`list`)에 넣어 둔
 * 그 달의 거래로 센다: 합계에 드는 거래(이체, 취소, 휴지통 제외)가 있는 날만, 날짜 순. `list.days`에 정해 둔 그날 합계가 앞선다.
 */
export function startDailyTotals(server: SetupServer, backend: Backend, list: TransactionList) {
  const daily = {
    /** 정해 두면 그 응답을 준다. */
    response: undefined as ((sent: DailyRequest) => Response | Promise<Response> | undefined) | undefined,
    requests: [] as DailyRequest[],
  }
  server.use(
    http.get('/api/v1/ledgers/:ledgerId/stats/daily', async ({ request, params }) => {
      const query = new URL(request.url).searchParams
      const sent: DailyRequest = {
        ledgerId: String(params.ledgerId),
        user: backend.userOf(request),
        month: query.get('month'),
        names: [...query.keys()],
      }
      daily.requests.push(sent)
      if (!sent.user) return problem(401, 'UNAUTHENTICATED')
      const answered = await daily.response?.(sent)
      if (answered) return answered
      if (sent.month === null) return problem(400, 'INVALID_REQUEST')
      const counted = (list.months.get(sent.month) ?? []).filter(
        ({ type, status, deletedAt }) => type !== 'TRANSFER' && status !== 'CANCELED' && deletedAt === null,
      )
      const dates = [...new Set(counted.map(({ occurredOn }) => String(occurredOn)))].sort()
      return HttpResponse.json({
        month: sent.month,
        days: dates.map((date) => ({
          date,
          ...(list.days.get(date) ?? sumsOf(counted.filter(({ occurredOn }) => occurredOn === date))),
        })),
      })
    }),
  )
  return daily
}

export type DailyTotals = ReturnType<typeof startDailyTotals>
