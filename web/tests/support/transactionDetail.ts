import { http, HttpResponse } from 'msw'
import type { SetupServer } from 'msw/node'
import type { Backend } from './backend'
import { problem } from './problem'
import type { savedOf } from './transactions'

/* 거래 상세(#15), 삭제·복원(#38)의 계약대로 답하는 가짜 서버 */

type Stored = ReturnType<typeof savedOf>

const DAY_MS = 24 * 60 * 60 * 1000

/** 서버가 휴지통의 거래를 영구 삭제하는 날 수(P-215). 화면은 응답의 purgeAt만 본다. */
const PURGE_DAYS = 30

/** 휴지통에 있는 거래로 바꿀 값. `deletedAt`에 영구 삭제 예정 시각을 더한다. */
export function trashed(deletedAt: string) {
  return { deletedAt, purgeAt: new Date(Date.parse(deletedAt) + PURGE_DAYS * DAY_MS).toISOString() }
}

/** 서버가 받은 상세·삭제·복원 요청 하나 */
export interface DetailRequest {
  ledgerId: string
  id: string
  /** 토큰의 사용자. 토큰이 없거나 만료됐으면 없다. */
  user: string | undefined
  /** X-Akkimpyo-Device 헤더 */
  device: string | null
  /** 받은 쿼리 문자열(`?` 뒤) */
  query: string
  /** 복원의 본문. 없으면 null */
  body: unknown
}

type Respond = (sent: DetailRequest) => Response | Promise<Response> | undefined

/**
 * 거래 상세, 삭제, 복원이 되는 가짜 서버. 넣어 둔 거래(목록의 것과 같은 객체여도 된다)를 그 자리에서 바꾼다.
 * 삭제하면 version을 올리고 deletedAt, purgeAt을 채우며, 복원하면 비운다. 응답을 정해 두면 그것이 앞선다.
 */
export function startTransactionDetail(server: SetupServer, backend: Backend) {
  const detail = {
    /** id마다 서버에 있는 거래 */
    items: new Map<string, Stored>(),
    /** 서버의 지금. 삭제한 시각이 된다. */
    now: () => new Date().toISOString(),
    getResponse: undefined as Respond | undefined,
    deleteResponse: undefined as Respond | undefined,
    restoreResponse: undefined as Respond | undefined,
    requests: { get: [] as DetailRequest[], delete: [] as DetailRequest[], restore: [] as DetailRequest[] },
    put(...items: Stored[]) {
      for (const item of items) detail.items.set(String(item.id), item)
    },
  }

  async function received(request: Request, params: Record<string, unknown>): Promise<DetailRequest> {
    const text = request.method === 'POST' ? await request.text() : ''
    return {
      ledgerId: String(params.ledgerId),
      id: String(params.id),
      user: backend.userOf(request),
      device: request.headers.get('X-Akkimpyo-Device'),
      query: new URL(request.url).search.slice(1),
      body: text === '' ? null : JSON.parse(text),
    }
  }

  /** 서버의 검사 순서: 인증 → 거래 있음 → 입력(version) → version → 상태 */
  async function change(sent: DetailRequest, version: unknown, deleting: boolean) {
    if (!sent.user) return problem(401, 'UNAUTHENTICATED')
    const item = detail.items.get(sent.id)
    if (!item) return problem(404, 'NOT_FOUND')
    if (!Number.isSafeInteger(version)) {
      return problem(400, 'VALIDATION_FAILED', { fieldErrors: [{ field: 'version', code: 'INVALID_FORMAT' }] })
    }
    if (version !== item.version) return problem(409, 'STALE_VERSION', { current: { ...item } })
    if ((item.deletedAt !== null) === deleting) return problem(409, 'INVALID_STATE')
    Object.assign(item, { version: item.version + 1 }, deleting ? trashed(detail.now()) : { deletedAt: null, purgeAt: null })
    return HttpResponse.json({ ...item })
  }

  server.use(
    http.get('/api/v1/ledgers/:ledgerId/transactions/:id', async ({ request, params }) => {
      const sent = await received(request, params)
      detail.requests.get.push(sent)
      if (!sent.user) return problem(401, 'UNAUTHENTICATED')
      const answered = await detail.getResponse?.(sent)
      if (answered) return answered
      const item = detail.items.get(sent.id)
      return item ? HttpResponse.json({ ...item }) : problem(404, 'NOT_FOUND')
    }),
    http.delete('/api/v1/ledgers/:ledgerId/transactions/:id', async ({ request, params }) => {
      const sent = await received(request, params)
      detail.requests.delete.push(sent)
      const answered = sent.user ? await detail.deleteResponse?.(sent) : undefined
      if (answered) return answered
      const version = new URLSearchParams(sent.query).get('version')
      return change(sent, version === null ? undefined : Number(version), true)
    }),
    http.post('/api/v1/ledgers/:ledgerId/transactions/:id/restore', async ({ request, params }) => {
      const sent = await received(request, params)
      detail.requests.restore.push(sent)
      const answered = sent.user ? await detail.restoreResponse?.(sent) : undefined
      if (answered) return answered
      return change(sent, (sent.body as { version?: unknown } | null)?.version, false)
    }),
  )
  return detail
}

export type TransactionDetailServer = ReturnType<typeof startTransactionDetail>
