import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../src/api/apiError'
import { fetchLastMonth } from '../src/features/transactions/fetchLastMonth'
import { parseLastMonth } from '../src/features/transactions/lastMonth'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import { expenseOf, incomeOf, pageOf } from './support/transactionList'

/*
 * 기기에 남기는 최근 한 달(P-902, #238). "최근 한 달"은 기기의 오늘을 포함한 지난 31일이다. #15의 장부 전체 모드(달 없이
 * limit=50, cursor)로 날짜 역순으로 받다가 31일 밖 날짜가 나오면 멈추고, 저장 범위가 걸친 달마다 그 달 합계를 따로 받는다
 * (ledger 2026-11-27).
 */

const server = startMockServer()

const ledgerId = '0b9f6c1e-3d52-4a7e-9c11-5f2e8a7d4b60'
const path = `/api/v1/ledgers/${ledgerId}/transactions`
const account = '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f'
const food = 'aaaaaaaa-0000-4000-8000-000000000001'

type Listed = ReturnType<typeof expenseOf>

const spend = (occurredOn: string, amount = 1000) =>
  expenseOf({ occurredOn, accountId: account, categoryId: food, amount, payee: `${occurredOn}의 가게` })

/** 받은 요청의 쿼리 */
let sent: URLSearchParams[] = []

/**
 * 장부 전체 모드는 `items`(서버의 순서로 넣는다)를 50건씩, 달 모드는 그 달의 합계를 준다. 합계는 달 글자로 알아보게
 * 지출에 달의 숫자를 넣는다.
 */
function serve(items: Listed[]) {
  sent = []
  server.use(
    http.get(path, ({ request }) => {
      const query = new URL(request.url).searchParams
      sent.push(query)
      const month = query.get('month')
      if (month !== null) return HttpResponse.json({ ...pageOf(month, [], 0, 1), totals: totalsOf(month) })
      const cursor = query.get('cursor')
      const start = cursor === null ? 0 : Number(cursor.split('|')[1])
      return HttpResponse.json(pageOf(null, items, start, Number(query.get('limit'))))
    }),
  )
}

const totalsOf = (month: string) => ({ income: 0, expense: Number(month.replace('-', '')) })

const ledgerRequests = () => sent.filter((query) => !query.has('month'))
const monthRequests = () => sent.filter((query) => query.has('month'))

describe('저장 범위(기기의 오늘을 포함한 지난 31일)', () => {
  it('31일째 날(오늘에서 30일 앞)은 넣고 32일째 날은 뺀다', async () => {
    const today = spend('2026-11-27')
    const day31 = spend('2026-10-28')
    const day32 = spend('2026-10-27')
    serve([today, day31, day32])
    const kept = await fetchLastMonth(ledgerId, '2026-11-27')
    expect(kept.from).toBe('2026-10-28')
    expect(kept.to).toBe('2026-11-27')
    expect(kept.items.map(({ id }) => id)).toEqual([today.id, day31.id])
    expect(kept.days.map(({ date }) => date)).toEqual(['2026-11-27', '2026-10-28'])
  })

  it('기기의 오늘보다 뒤의 날짜는 남기지 않는다(장부의 오늘이 기기보다 앞선 시간대)', async () => {
    const tomorrow = spend('2026-11-28')
    const today = spend('2026-11-27')
    serve([tomorrow, today])
    const kept = await fetchLastMonth(ledgerId, '2026-11-27')
    expect(kept.items.map(({ id }) => id)).toEqual([today.id])
    expect(kept.days.map(({ date }) => date)).toEqual(['2026-11-27'])
  })

  it('장부 전체 모드로 50건씩 받고 cursor를 그대로 보낸다', async () => {
    serve(Array.from({ length: 120 }, (_, index) => spend(index < 60 ? '2026-11-20' : '2026-11-10')))
    const kept = await fetchLastMonth(ledgerId, '2026-11-27')
    expect(kept.items).toHaveLength(120)
    expect(ledgerRequests().map((query) => [...query.entries()])).toEqual([
      [['limit', '50']],
      [
        ['limit', '50'],
        ['cursor', 'all|50'],
      ],
      [
        ['limit', '50'],
        ['cursor', 'all|100'],
      ],
    ])
  })

  it('31일 밖 날짜가 나온 쪽에서 멈추고 다음 쪽을 받지 않는다', async () => {
    const inside = Array.from({ length: 40 }, () => spend('2026-11-01'))
    const outside = Array.from({ length: 60 }, () => spend('2026-10-01'))
    serve([...inside, ...outside])
    const kept = await fetchLastMonth(ledgerId, '2026-11-27')
    expect(kept.items).toHaveLength(40)
    expect(ledgerRequests()).toHaveLength(1)
  })

  it('쪽의 마지막 거래가 31일째 날이면 그날이 다음 쪽에 이어질 수 있어 더 받는다', async () => {
    const day31 = Array.from({ length: 55 }, () => spend('2026-10-28'))
    serve([...day31, spend('2026-10-27')])
    const kept = await fetchLastMonth(ledgerId, '2026-11-27')
    expect(kept.items).toHaveLength(55)
    expect(ledgerRequests()).toHaveLength(2)
  })

  it('20쪽(1,000건)에서 멈추고, 끝까지 받지 못한 날부터는 저장 범위에서 뺀다(architect #238 A)', async () => {
    // 하루 40건씩 30일 = 1,200건. 20쪽째(1,000건)의 마지막 날(2026-11-06)은 다음 쪽에 이어질 수 있어 끝까지 받았는지 모른다
    const items = Array.from({ length: 30 }, (_, day) => day).flatMap((day) => {
      const date = `2026-11-${String(30 - day).padStart(2, '0')}`
      return Array.from({ length: 40 }, () => spend(date))
    })
    serve(items)
    const kept = await fetchLastMonth(ledgerId, '2026-11-30')
    expect(ledgerRequests()).toHaveLength(20)
    expect(kept.truncated).toBe(true)
    // 그날은 빼고 그다음 날부터 남긴다
    expect(kept.from).toBe('2026-11-07')
    expect(kept.items).toHaveLength(24 * 40)
    expect(kept.items.every(({ occurredOn }) => occurredOn >= '2026-11-07')).toBe(true)
    expect(kept.days.at(-1)?.date).toBe('2026-11-07')
    expect(kept.months.map(({ month }) => month)).toEqual(['2026-11'])
  })

  it('끝까지 받았으면 잘리지 않았다', async () => {
    serve([spend('2026-11-20')])
    expect((await fetchLastMonth(ledgerId, '2026-11-27')).truncated).toBe(false)
  })

  it('거래가 없으면 한 번만 받고 빈 사본이다', async () => {
    serve([])
    const kept = await fetchLastMonth(ledgerId, '2026-11-27')
    expect(kept.items).toEqual([])
    expect(kept.days).toEqual([])
    expect(ledgerRequests()).toHaveLength(1)
  })
})

describe('달 합계', () => {
  it.each([
    ['두 달에 걸침', '2026-11-27', '2026-10-28', ['2026-10', '2026-11']],
    ['한 달 안(오늘이 31일)', '2026-12-31', '2026-12-01', ['2026-12']],
    ['오늘이 30일인 달', '2026-11-30', '2026-10-31', ['2026-10', '2026-11']],
    ['2월이 끼어 세 달', '2027-03-01', '2027-01-30', ['2027-01', '2027-02', '2027-03']],
    ['윤년의 3월 1일', '2028-03-01', '2028-01-31', ['2028-01', '2028-02', '2028-03']],
    ['3월 3일은 2월부터', '2027-03-03', '2027-02-01', ['2027-02', '2027-03']],
    ['해가 바뀜', '2027-01-15', '2026-12-16', ['2026-12', '2027-01']],
  ])('저장 범위가 걸친 달마다 그 달 합계를 한 건씩 받는다(%s)', async (_, today, from, months) => {
    serve([])
    const kept = await fetchLastMonth(ledgerId, today)
    expect(kept.from).toBe(from)
    expect(kept.months).toEqual(months.map((month) => ({ month, totals: totalsOf(month) })))
    expect(monthRequests().map((query) => [...query.entries()])).toEqual(
      months.map((month) => [
        ['month', month],
        ['limit', '1'],
      ]),
    )
  })
})

describe('실패', () => {
  async function failureOf(promise: Promise<unknown>) {
    const error = await promise.catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(ApiError)
    return error as ApiError
  }

  it('어느 한 쪽이라도 약속과 다르면 받지 않는다', async () => {
    serve(Array.from({ length: 60 }, () => spend('2026-11-20')))
    server.use(
      http.get(path, ({ request }) => {
        const query = new URL(request.url).searchParams
        if (query.get('cursor') === 'all|50') return HttpResponse.json({ items: 'nope', nextCursor: null, totals: null, days: [] })
        return undefined
      }),
    )
    expect((await failureOf(fetchLastMonth(ledgerId, '2026-11-27'))).kind).toBe('server')
  })

  it('달 합계를 받지 못하면 받지 않는다', async () => {
    serve([spend('2026-11-20')])
    server.use(http.get(path, ({ request }) => (new URL(request.url).searchParams.has('month') ? problem(500, 'INTERNAL_ERROR') : undefined)))
    expect((await failureOf(fetchLastMonth(ledgerId, '2026-11-27'))).status).toBe(500)
  })
})

describe('기기에서 읽은 사본의 모양(parseLastMonth)', () => {
  async function kept() {
    serve([spend('2026-11-27', 3000), incomeOf({ occurredOn: '2026-11-01', accountId: account, categoryId: food, amount: 5000 })])
    return fetchLastMonth(ledgerId, '2026-11-27')
  }

  it('받은 그대로의 사본은 같은 값으로 읽는다', async () => {
    const value = await kept()
    expect(parseLastMonth(structuredClone(value))).toEqual(value)
  })

  it.each([
    ['비었다', () => null],
    ['날짜가 아니다', (value: object) => ({ ...value, from: '2026-10-32' })],
    ['범위가 뒤집혔다', (value: object) => ({ ...value, from: '2026-12-01' })],
    ['거래의 모양이 틀렸다', (value: { items: object[] }) => ({ ...value, items: [{ ...value.items[0], amount: -1 }] })],
    ['범위 밖의 거래가 있다', (value: { items: object[] }) => ({ ...value, items: [{ ...value.items[0], occurredOn: '2026-10-01' }] })],
    ['그날 합계의 모양이 틀렸다', (value: object) => ({ ...value, days: [{ date: '2026-11-27', income: 0 }] })],
    ['달 합계의 모양이 틀렸다', (value: object) => ({ ...value, months: [{ month: '2026-13', totals: { income: 0, expense: 0 } }] })],
  ])('모양이 틀리면(%s) 없다', async (_, change) => {
    const value = await kept()
    expect(parseLastMonth(change(value as never))).toBeUndefined()
  })
})
