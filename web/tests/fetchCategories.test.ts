import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../src/api/apiError'
import { fetchCategories } from '../src/features/categories/categories'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'

const server = startMockServer()

const ledgerId = '0b9f6c1e-3d52-4a7e-9c11-5f2e8a7d4b60'
const path = `/api/v1/ledgers/${ledgerId}/categories`

const food = {
  id: '11111111-0000-4000-8000-000000000001',
  kind: 'EXPENSE',
  name: '식비',
  system: false,
  children: [
    { id: '11111111-0000-4000-8000-000000000011', name: '외식' },
    { id: '11111111-0000-4000-8000-000000000012', name: '장보기' },
  ],
}
const uncategorized = {
  id: '11111111-0000-4000-8000-000000000002',
  kind: 'EXPENSE',
  name: '미분류',
  system: true,
  children: [],
}
const salary = { id: '22222222-0000-4000-8000-000000000001', kind: 'INCOME', name: '급여', system: false, children: [] }

function respondWith(body: unknown) {
  server.use(http.get(path, () => HttpResponse.json(body as object)))
}

describe('카테고리 목록(GET /api/v1/ledgers/{ledgerId}/categories)', () => {
  it('장부의 최상위 카테고리와 그 하위를 받은 순서대로 준다', async () => {
    respondWith({ items: [salary, uncategorized, food] })
    expect(await fetchCategories(ledgerId)).toEqual([salary, uncategorized, food])
  })

  it('카테고리가 하나도 없는 응답도 받는다', async () => {
    respondWith({ items: [] })
    expect(await fetchCategories(ledgerId)).toEqual([])
  })

  it('모르는 필드가 있어도 된다', async () => {
    respondWith({ items: [{ ...food, added: 1, children: [{ ...food.children[0], added: 2 }] }], added: 3 })
    const [category] = await fetchCategories(ledgerId)
    expect(category.name).toBe('식비')
    expect(category.children[0].name).toBe('외식')
  })

  const changed = (fields: object) => ({ items: [food, { ...food, ...fields }] })
  it.each([
    ['모르는 구분', changed({ kind: 'TRANSFER' })],
    ['Object의 속성 이름인 구분', changed({ kind: 'toString' })],
    ['구분이 없음', changed({ kind: undefined })],
    ['id가 없음', changed({ id: undefined })],
    ['이름이 없음', changed({ name: undefined })],
    ['이름이 글자가 아님', changed({ name: 1 })],
    ['미분류 표시가 없음', changed({ system: undefined })],
    ['미분류 표시가 글자', changed({ system: 'false' })],
    ['하위가 없음', changed({ children: undefined })],
    ['하위가 null', changed({ children: null })],
    ['하위가 배열이 아님', changed({ children: { items: [] } })],
    ['하위의 원소가 null', changed({ children: [null] })],
    ['하위의 id가 없음', changed({ children: [{ name: '외식' }] })],
    ['하위의 이름이 없음', changed({ children: [food.children[0], { id: 'a' }] })],
    ['카테고리가 null', { items: [food, null] }],
    ['목록이 없음', {}],
    ['목록이 null', { items: null }],
    ['목록이 배열이 아님', { items: food }],
    ['묶지 않은 배열', [food]],
    ['null', null],
    ['글자', 'items'],
  ])('약속과 다른 응답은 서버 오류로 본다: %s', async (_, body) => {
    respondWith(body)
    const error = await fetchCategories(ledgerId).catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).kind).toBe('server')
  })

  it('빈 응답도 서버 오류로 본다', async () => {
    server.use(http.get(path, () => new HttpResponse(null, { status: 204 })))
    await expect(fetchCategories(ledgerId)).rejects.toMatchObject({ kind: 'server' })
  })

  it('서버가 거부하면 그 오류를 그대로 던진다', async () => {
    server.use(http.get(path, () => problem(404, 'NOT_FOUND')))
    await expect(fetchCategories(ledgerId)).rejects.toMatchObject({ kind: 'rejected', status: 404, code: 'NOT_FOUND' })
  })
})
