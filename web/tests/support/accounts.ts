import { http, HttpResponse } from 'msw'
import type { SetupServer } from 'msw/node'
import type { Backend } from './backend'
import { problem } from './problem'

/** 서버가 주는 계좌 하나(#13, #33의 응답 계약). 거래가 없어 잔액이 시작 잔액이다. */
export function accountOf(name: string, type: string, balance: number) {
  return { id: `id-${name}`, name, type, balance, openingBalance: balance, openingDate: '2026-11-01', hidden: false }
}

export const accountsBody = (...items: object[]) => HttpResponse.json({ items })

interface NewAccountBody {
  name: string
  type: string
  openingBalance: number
  openingDate: string
}

/** 가짜 서버가 가진 계좌. 잔액에서 시작 잔액을 뺀 것이 기준일 이후 거래의 몫이다. */
interface StoredAccount {
  id: string
  balance: number
  openingBalance?: number
}

/** 계좌 목록, 추가, 수정(#33)이 되는 가짜 서버. 계좌가 없는 장부에서 시작한다. */
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
    /** 정해 두면 수정에 그 응답을 준다. */
    updateResponse: undefined as (() => Response | Promise<Response>) | undefined,
    /** 수정을 받은 장부 id, 계좌 id와 본문 */
    updated: [] as { ledgerId: string; accountId: string; body: NewAccountBody }[],
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
    http.put('/api/v1/ledgers/:ledgerId/accounts/:accountId', async ({ request, params }) => {
      const body = (await request.json()) as NewAccountBody
      const accountId = String(params.accountId)
      accounts.updated.push({ ledgerId: String(params.ledgerId), accountId, body })
      if (!backend.userOf(request)) return problem(401, 'UNAUTHENTICATED')
      if (accounts.updateResponse) return accounts.updateResponse()
      const saved = accounts.items.find((item) => (item as StoredAccount).id === accountId) as StoredAccount | undefined
      if (!saved) return problem(404, 'NOT_FOUND')
      // 서버는 바꾼 시작 잔액에 기준일 이후 거래를 더해 잔액을 다시 구한다(P-206). 가짜 서버는 거래의 몫을 그대로 둔다
      const transactions = saved.balance - (saved.openingBalance ?? saved.balance)
      const updated = { ...saved, ...body, balance: body.openingBalance + transactions }
      accounts.items = accounts.items.map((item) => (item === saved ? updated : item))
      return HttpResponse.json(updated)
    }),
  )
  return accounts
}

export type Accounts = ReturnType<typeof startAccounts>
