import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../src/api/apiError'
import { fetchMonthlyStats } from '../src/features/stats/monthlyStats'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'

/* 월별 통계 API(#16의 응답 계약, PR #334). 합계와 상위 카테고리는 서버가 계산하고(P-205), 앱은 받은 값을 그대로 쓴다. */

const server = startMockServer()

const ledgerId = '0b9f6c1e-3d52-4a7e-9c11-5f2e8a7d4b60'
const path = `/api/v1/ledgers/${ledgerId}/stats/monthly`
const food = '11111111-0000-4000-8000-000000000001'
const uncategorized = '11111111-0000-4000-8000-000000000002'

const november = {
  month: '2026-11',
  income: 3200000,
  expense: 1245300,
  net: 1954700,
  topExpenseCategories: [
    { categoryId: food, amount: 412000 },
    { categoryId: uncategorized, amount: 3000 },
  ],
}

/** 받은 요청의 쿼리 */
const requests: URLSearchParams[] = []

function respondWith(body: unknown) {
  requests.length = 0
  server.use(
    http.get(path, ({ request }) => {
      requests.push(new URL(request.url).searchParams)
      return HttpResponse.json(body as object)
    }),
  )
}

describe('월별 통계(GET /api/v1/ledgers/{ledgerId}/stats/monthly)', () => {
  it('그 달 하나만 month로 보내고, 수입·지출·차액과 상위 카테고리를 받은 순서대로 준다', async () => {
    respondWith(november)
    expect(await fetchMonthlyStats(ledgerId, '2026-11')).toEqual({
      income: 3200000,
      expense: 1245300,
      net: 1954700,
      topExpenses: [
        { categoryId: food, amount: 412000 },
        { categoryId: uncategorized, amount: 3000 },
      ],
    })
    expect(requests.map((query) => [...query.entries()])).toEqual([[['month', '2026-11']]])
  })

  it('거래가 없는 달은 0원과 빈 목록이다', async () => {
    respondWith({ month: '2026-10', income: 0, expense: 0, net: 0, topExpenseCategories: [] })
    expect(await fetchMonthlyStats(ledgerId, '2026-10')).toEqual({ income: 0, expense: 0, net: 0, topExpenses: [] })
  })

  it('환불이 더 큰 달의 음수 지출과 음수 차액을 그대로 받는다', async () => {
    respondWith({ month: '2026-11', income: 0, expense: -12000, net: 12000, topExpenseCategories: [] })
    expect(await fetchMonthlyStats(ledgerId, '2026-11')).toMatchObject({ expense: -12000, net: 12000 })
    respondWith({ month: '2026-11', income: 0, expense: 120000, net: -120000, topExpenseCategories: [] })
    expect(await fetchMonthlyStats(ledgerId, '2026-11')).toMatchObject({ net: -120000 })
  })

  it('모르는 필드가 있어도 된다', async () => {
    respondWith({ ...november, added: 1, topExpenseCategories: [{ ...november.topExpenseCategories[0], added: 2 }] })
    expect((await fetchMonthlyStats(ledgerId, '2026-11')).topExpenses).toEqual([{ categoryId: food, amount: 412000 }])
  })

  const five = Array.from({ length: 5 }, (_, index) => ({ categoryId: `c${index}`, amount: 5 - index }))
  it('상위 카테고리는 다섯 개까지 받는다', async () => {
    respondWith({ ...november, topExpenseCategories: five })
    expect((await fetchMonthlyStats(ledgerId, '2026-11')).topExpenses).toHaveLength(5)
  })

  const top = (entry: object) => ({ ...november, topExpenseCategories: [november.topExpenseCategories[0], entry] })
  it.each([
    ['다른 달', { ...november, month: '2026-10' }],
    ['달이 없음', { ...november, month: undefined }],
    ['수입이 없음', { ...november, income: undefined }],
    ['지출이 글자', { ...november, expense: '1245300' }],
    ['차액이 소수', { ...november, net: 1954700.5 }],
    ['수입이 안전한 정수 밖', { ...november, income: 2 ** 53 }],
    ['목록이 없음', { ...november, topExpenseCategories: undefined }],
    ['목록이 배열이 아님', { ...november, topExpenseCategories: {} }],
    ['여섯 개', { ...november, topExpenseCategories: [...five, { categoryId: 'c5', amount: 1 }] }],
    ['원소가 null', top(null as unknown as object)],
    ['id가 없음', top({ amount: 1 })],
    ['id가 빈 글자', top({ categoryId: '', amount: 1 })],
    ['금액이 0', top({ categoryId: 'c', amount: 0 })],
    ['금액이 음수', top({ categoryId: 'c', amount: -1 })],
    ['금액이 소수', top({ categoryId: 'c', amount: 1.5 })],
    ['null', null],
    ['글자', 'stats'],
  ])('약속과 다른 응답은 서버 오류로 본다: %s', async (_, body) => {
    respondWith(body)
    const error = await fetchMonthlyStats(ledgerId, '2026-11').catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).kind).toBe('server')
  })

  it('서버가 거부하면 그 오류를 그대로 던진다', async () => {
    server.use(http.get(path, () => problem(404, 'NOT_FOUND')))
    await expect(fetchMonthlyStats(ledgerId, '2026-11')).rejects.toMatchObject({
      kind: 'rejected',
      status: 404,
      code: 'NOT_FOUND',
    })
  })

  it('UUID 모양이 아닌 장부 id로는 보내지 않는다', async () => {
    await expect(fetchMonthlyStats('../me', '2026-11')).rejects.toMatchObject({ kind: 'server' })
  })
})
