import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../src/api/apiError'
import { canEdit, fetchMe } from '../src/features/me/me'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'

const server = startMockServer()

const ledger = { id: '0b9f6c1e-3d52-4a7e-9c11-5f2e8a7d4b60', name: '내 가계부', role: 'OWNER' }
const me = {
  id: '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b',
  email: 'name@example.com',
  displayName: '예시 사용자',
  ledgers: [ledger],
}

function respondWith(body: unknown) {
  server.use(http.get('/api/v1/me', () => HttpResponse.json(body as object)))
}

describe('내 정보(GET /api/v1/me)', () => {
  it('표시 이름과 장부 목록을 받은 순서대로 준다', async () => {
    const second = { ...ledger, id: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f', name: '둘째 장부', role: 'MEMBER' }
    respondWith({ ...me, ledgers: [ledger, second] })
    const { displayName, ledgers } = await fetchMe()
    expect(displayName).toBe('예시 사용자')
    expect(ledgers).toEqual([ledger, second])
  })

  it('모르는 권한은 값 그대로 들고 있는다', async () => {
    respondWith({ ...me, ledgers: [{ ...ledger, role: 'SOMETHING_NEW' }] })
    expect((await fetchMe()).ledgers[0].role).toBe('SOMETHING_NEW')
  })

  it('모르는 필드가 있어도 된다', async () => {
    respondWith({ ...me, added: 1, ledgers: [{ ...ledger, added: [] }] })
    expect((await fetchMe()).ledgers[0].name).toBe('내 가계부')
  })

  it.each([
    ['장부가 하나도 없음', { ...me, ledgers: [] }],
    ['장부 목록이 없음', { ...me, ledgers: undefined }],
    ['장부 목록이 null', { ...me, ledgers: null }],
    ['장부 목록이 배열이 아님', { ...me, ledgers: { items: [ledger] } }],
    ['장부가 null', { ...me, ledgers: [null] }],
    ['장부 id가 없음', { ...me, ledgers: [{ name: '내 가계부', role: 'OWNER' }] }],
    ['장부 이름이 글자가 아님', { ...me, ledgers: [{ ...ledger, name: 1 }] }],
    ['권한이 없음', { ...me, ledgers: [{ ...ledger, role: undefined }] }],
    ['둘째 장부가 깨짐', { ...me, ledgers: [ledger, {}] }],
    ['표시 이름이 없음', { ...me, displayName: undefined }],
    ['표시 이름이 null', { ...me, displayName: null }],
    ['배열', [me]],
    ['null', null],
    ['글자', 'me'],
  ])('약속과 다른 응답은 서버 오류로 본다: %s', async (_, body) => {
    respondWith(body)
    const error = await fetchMe().catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).kind).toBe('server')
  })

  it('빈 응답도 서버 오류로 본다', async () => {
    server.use(http.get('/api/v1/me', () => new HttpResponse(null, { status: 204 })))
    await expect(fetchMe()).rejects.toMatchObject({ kind: 'server' })
  })

  it('서버가 거부하면 그 오류를 그대로 던진다', async () => {
    server.use(http.get('/api/v1/me', () => problem(401, 'UNAUTHENTICATED')))
    await expect(fetchMe()).rejects.toMatchObject({ kind: 'rejected', status: 401, code: 'UNAUTHENTICATED' })
  })
})

describe('편집 이상', () => {
  it.each([
    ['OWNER', true],
    ['MEMBER', true],
    // 보기 전용과 서버가 앞으로 더할 모르는 값은 편집할 수 없는 것으로 본다(#30)
    ['VIEWER', false],
    ['ADMIN', false],
    ['owner', false],
    ['', false],
  ])('%s: %s', (role, expected) => {
    expect(canEdit({ ...ledger, role })).toBe(expected)
  })
})
