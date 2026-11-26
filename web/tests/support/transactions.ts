import { http, HttpResponse } from 'msw'
import type { SetupServer } from 'msw/node'
import type { Backend } from './backend'
import { problem } from './problem'

/** 서버가 받은 거래 만들기 요청 하나 */
export interface SentTransaction {
  ledgerId: string
  /** 토큰의 사용자. 토큰이 없거나 만료됐으면 없다. */
  user: string | undefined
  /** X-Akkimpyo-Device 헤더 */
  device: string | null
  headers: Headers
  body: Record<string, unknown>
}

/** 서버가 저장한 거래(#14의 응답 계약). 받은 본문에 서버 값을 더한다. */
export function savedOf(body: Record<string, unknown>, user = 'user-1', changes: object = {}) {
  const person = { id: user, displayName: `${user}의 이름` }
  const transfer = body.type === 'TRANSFER'
  return {
    id: body.id,
    type: body.type,
    occurredOn: body.occurredOn,
    occurredTime: body.occurredTime ?? null,
    accountId: transfer ? null : body.accountId,
    categoryId: transfer ? null : (body.categoryId ?? 'uncategorized'),
    amount: body.amount,
    payee: transfer ? null : (body.payee ?? null),
    memo: body.memo ?? null,
    refund: transfer ? null : false,
    paidBy: transfer ? null : person,
    fromAccountId: transfer ? body.fromAccountId : null,
    toAccountId: transfer ? body.toAccountId : null,
    status: 'POSTED',
    version: 1,
    createdAt: '2026-11-26T03:15:00.123Z',
    updatedAt: '2026-11-26T03:15:00.123Z',
    updatedBy: person,
    deletedAt: null,
    ...changes,
  }
}

/** 거래 만들기가 되는 가짜 서버. 정해 두지 않으면 201과 저장한 거래를 준다. */
export function startTransactions(server: SetupServer, backend: Backend) {
  const transactions = {
    sent: [] as SentTransaction[],
    /** 정해 두면 그 응답을 준다. */
    response: undefined as ((sent: SentTransaction) => Response | Promise<Response>) | undefined,
  }
  server.use(
    http.post('/api/v1/ledgers/:ledgerId/transactions', async ({ request, params }) => {
      const sent: SentTransaction = {
        ledgerId: String(params.ledgerId),
        user: backend.userOf(request),
        device: request.headers.get('X-Akkimpyo-Device'),
        headers: request.headers,
        body: (await request.json()) as Record<string, unknown>,
      }
      transactions.sent.push(sent)
      if (!sent.user) return problem(401, 'UNAUTHENTICATED')
      if (transactions.response) return transactions.response(sent)
      return HttpResponse.json(savedOf(sent.body, sent.user), { status: 201 })
    }),
  )
  return transactions
}

export type Transactions = ReturnType<typeof startTransactions>
