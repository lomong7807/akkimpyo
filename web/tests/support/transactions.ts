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
    // 환불 구분(서버 #8, PR #397). 일반 지출과 수입·이체는 null이다
    refundKind: null,
    paidBy: transfer ? null : person,
    fromAccountId: transfer ? body.fromAccountId : null,
    toAccountId: transfer ? body.toAccountId : null,
    status: 'POSTED',
    version: 1,
    createdAt: '2026-11-26T03:15:00.123Z',
    createdBy: person,
    updatedAt: '2026-11-26T03:15:00.123Z',
    updatedBy: person,
    deletedAt: null,
    purgeAt: null,
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

/** 서버가 받은 중복 경고 조회 하나(#59) */
export interface DuplicateQuery {
  ledgerId: string
  /** 토큰의 사용자. 토큰이 없거나 만료됐으면 없다. */
  user: string | undefined
  occurredOn: string | null
  amount: string | null
  payee: string | null
  exclude: string | null
  /** 받은 쿼리의 이름 */
  names: string[]
}

type Stored = ReturnType<typeof savedOf>

/** 서버처럼 가맹점을 맞춘다: 조합형, 공백류를 모두 빼고, 대소문자 무시(#61, #59의 PayeeMatch) */
const payeeKey = (payee: unknown) => (typeof payee === 'string' ? payee.normalize('NFC').replace(/\s/g, '').toLowerCase() : '')

/**
 * 중복 경고 조회가 되는 가짜 서버(#59의 계약, `{ items }`). `items`는 장부에 저장된 거래를 서버의 순서(저장 시각 최신 순)로
 * 넣어 둔다. 지출·수입만, 휴지통 제외, 같은 날짜·금액·가맹점, exclude는 뺀 것을 5건까지 준다. 가맹점이 비면 빈 items다.
 */
export function startDuplicates(server: SetupServer, backend: Backend) {
  const duplicates = {
    items: [] as Stored[],
    requests: [] as DuplicateQuery[],
    /** 정해 두면 그 응답을 준다. */
    response: undefined as ((query: DuplicateQuery) => Response | Promise<Response>) | undefined,
  }
  server.use(
    http.get('/api/v1/ledgers/:ledgerId/transactions/duplicates', ({ request, params }) => {
      const search = new URL(request.url).searchParams
      const query: DuplicateQuery = {
        ledgerId: String(params.ledgerId),
        user: backend.userOf(request),
        occurredOn: search.get('occurredOn'),
        amount: search.get('amount'),
        payee: search.get('payee'),
        exclude: search.get('exclude'),
        names: [...search.keys()],
      }
      duplicates.requests.push(query)
      if (!query.user) return problem(401, 'UNAUTHENTICATED')
      if (duplicates.response) return duplicates.response(query)
      const wanted = payeeKey(query.payee)
      if (wanted === '') return HttpResponse.json({ items: [] })
      const items = duplicates.items
        .filter(
          (item) =>
            item.type !== 'TRANSFER' &&
            item.deletedAt === null &&
            item.occurredOn === query.occurredOn &&
            String(item.amount) === query.amount &&
            payeeKey(item.payee) === wanted &&
            String(item.id) !== query.exclude,
        )
        .slice(0, 5)
      return HttpResponse.json({ items })
    }),
  )
  return duplicates
}

export type Duplicates = ReturnType<typeof startDuplicates>
