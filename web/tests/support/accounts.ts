import { http, HttpResponse } from 'msw'
import type { SetupServer } from 'msw/node'
import type { Backend } from './backend'
import { problem } from './problem'

/** 서버가 주는 계좌 하나(#13의 응답 계약) */
export function accountOf(name: string, type: string, balance: number) {
  return { id: `id-${name}`, name, type, balance, openingDate: '2026-11-01' }
}

export const accountsBody = (...items: object[]) => HttpResponse.json({ items })

interface NewAccountBody {
  name: string
  type: string
  openingBalance: number
  openingDate: string
}

/** 계좌 목록과 추가가 되는 가짜 서버. 계좌가 없는 장부에서 시작한다. */
export function startAccounts(server: SetupServer, backend: Backend) {
  const accounts = {
    items: [] as object[],
    /** 정해 두면 그 응답을 준다. */
    response: undefined as (() => Response | Promise<Response>) | undefined,
    /** 요청받은 장부 id */
    requests: [] as string[],
    /** 정해 두면 추가에 그 응답을 준다. */
    addResponse: undefined as (() => Response | Promise<Response>) | undefined,
    /** 추가를 받은 장부 id와 본문 */
    added: [] as { ledgerId: string; body: NewAccountBody }[],
  }
  server.use(
    http.get('/api/v1/ledgers/:ledgerId/accounts', ({ request, params }) => {
      accounts.requests.push(String(params.ledgerId))
      if (!backend.userOf(request)) return problem(401, 'UNAUTHENTICATED')
      return accounts.response ? accounts.response() : accountsBody(...accounts.items)
    }),
    http.post('/api/v1/ledgers/:ledgerId/accounts', async ({ request, params }) => {
      const body = (await request.json()) as NewAccountBody
      accounts.added.push({ ledgerId: String(params.ledgerId), body })
      if (!backend.userOf(request)) return problem(401, 'UNAUTHENTICATED')
      if (accounts.addResponse) return accounts.addResponse()
      const created = { ...accountOf(body.name, body.type, body.openingBalance), openingDate: body.openingDate }
      accounts.items = [...accounts.items, created]
      return HttpResponse.json(created, { status: 201 })
    }),
  )
  return accounts
}

export type Accounts = ReturnType<typeof startAccounts>
