import { http, HttpResponse } from 'msw'
import type { SetupServer } from 'msw/node'
import { afterEach } from 'vitest'
import { accessTokenNamed } from './accessToken'
import { problem } from './problem'

type Respond = () => Response | Promise<Response>

/** 사용자마다 다른 값. 화면에 누구의 값이 나왔는지 알아본다. */
export function ledgerNameOf(user: string): string {
  return `${user}의 장부`
}

/** 사용자마다 다른 장부 id. 서버처럼 UUID다. 앞자리로 어느 사용자의 장부인지 알아본다. */
export function ledgerIdOf(user: string): string {
  const hex = [...new TextEncoder().encode(user)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `1ed9e700-0000-4000-8000-${hex.padStart(12, '0').slice(-12)}`
}

export function meOf(user: string) {
  return {
    id: user,
    email: `${user}@example.com`,
    displayName: `${user}의 이름`,
    ledgers: [{ id: ledgerIdOf(user), name: ledgerNameOf(user), role: 'OWNER' }],
  }
}

/**
 * 로그인, 가입, 갱신, 로그아웃, 내 정보가 되는 가짜 서버. 로그인하지 않은 기기에서 시작한다.
 * 사용자는 이미 계좌가 있어, 들어올 때 계좌 목록을 받아도 첫 실행 안내(C-02)로 가지 않는다.
 * 계좌를 다루는 테스트는 startAccounts가 이 계좌 목록을 덮는다.
 * 홈(C-01)이 받는 거래 목록(#15)과 카테고리(#34)는 비어 있다. 다루는 테스트는 startTransactionList, startCategories가 덮는다.
 */
export function startBackend(server: SetupServer) {
  const tokens = new Map<string, string>()
  let issued = 0

  const backend = {
    /** refresh 쿠키가 가리키는 사용자. 없으면 갱신이 401이다. */
    cookieUser: undefined as string | undefined,
    /** 다음에 로그인할 사용자 */
    loginUser: 'user-1',
    /** 다음에 가입할 사용자 */
    signupUser: 'new-user',
    /** 정해 두면 그 응답을 준다. 없으면 위의 상태대로 답한다. */
    refreshResponse: undefined as Respond | undefined,
    loginResponse: undefined as Respond | undefined,
    signupResponse: undefined as Respond | undefined,
    logoutResponse: undefined as Respond | undefined,
    meResponse: undefined as Respond | undefined,
    requests: {
      refresh: [] as Request[],
      login: [] as Request[],
      signup: [] as Request[],
      logout: [] as Request[],
      me: [] as string[],
      /** 계좌 목록을 요청한 사용자. 토큰이 없거나 만료됐으면 '만료'다. */
      accounts: [] as string[],
    },
    /** access token을 모두 만료시킨다. */
    expireTokens: () => tokens.clear(),
    /** 요청을 보낸 사용자. 토큰이 없거나 만료됐으면 없다. */
    userOf: (request: Request) => tokens.get(request.headers.get('Authorization')?.replace('Bearer ', '') ?? ''),
    issue(user: string, status = 200) {
      issued += 1
      const token = accessTokenNamed(`token-${issued}`, { sub: user })
      tokens.set(token, user)
      return HttpResponse.json({ accessToken: token }, { status })
    },
  }

  server.use(
    http.post('/api/v1/auth/refresh', ({ request }) => {
      backend.requests.refresh.push(request)
      if (backend.refreshResponse) return backend.refreshResponse()
      return backend.cookieUser ? backend.issue(backend.cookieUser) : problem(401, 'UNAUTHENTICATED')
    }),
    http.post('/api/v1/auth/login', ({ request }) => {
      backend.requests.login.push(request)
      if (backend.loginResponse) return backend.loginResponse()
      backend.cookieUser = backend.loginUser
      return backend.issue(backend.loginUser)
    }),
    http.post('/api/v1/auth/signup', ({ request }) => {
      backend.requests.signup.push(request)
      if (backend.signupResponse) return backend.signupResponse()
      backend.cookieUser = backend.signupUser
      return backend.issue(backend.signupUser, 201)
    }),
    http.post('/api/v1/auth/logout', ({ request }) => {
      backend.requests.logout.push(request)
      if (backend.logoutResponse) return backend.logoutResponse()
      backend.cookieUser = undefined
      return new HttpResponse(null, { status: 204 })
    }),
    http.get('/api/v1/me', ({ request }) => {
      const user = backend.userOf(request)
      backend.requests.me.push(user ?? '만료')
      if (!user) return problem(401, 'UNAUTHENTICATED')
      return backend.meResponse ? backend.meResponse() : HttpResponse.json(meOf(user))
    }),
    http.get('/api/v1/ledgers/:ledgerId/accounts', ({ request }) => {
      const user = backend.userOf(request)
      backend.requests.accounts.push(user ?? '만료')
      if (!user) return problem(401, 'UNAUTHENTICATED')
      return HttpResponse.json({ items: [{ id: `${user}-account`, name: '통장', type: 'BANK', balance: 0 }] })
    }),
    http.get('/api/v1/ledgers/:ledgerId/transactions', ({ request }) => {
      if (!backend.userOf(request)) return problem(401, 'UNAUTHENTICATED')
      // 달이 있으면 그 달의 합계가 있고, 없으면(장부 전체) 합계가 없다
      const month = new URL(request.url).searchParams.get('month')
      const totals = month === null ? null : { income: 0, expense: 0 }
      return HttpResponse.json({ items: [], nextCursor: null, totals, days: [] })
    }),
    http.get('/api/v1/ledgers/:ledgerId/categories', ({ request }) => {
      if (!backend.userOf(request)) return problem(401, 'UNAUTHENTICATED')
      return HttpResponse.json({ items: [] })
    }),
  )
  return backend
}

export type Backend = ReturnType<typeof startBackend>

const unanswered: (() => void)[] = []

// 답이 없으면 세션 계층이 5초 뒤 갱신을 한 번 더 보낸다. 다음 테스트의 서버에 닿지 않게 남은 것을 끝낸다
afterEach(() => {
  unanswered.splice(0).forEach((finish) => finish())
})

/** 답을 미루는 응답. `answer`를 부를 때까지 요청이 끝나지 않는다. */
export function delayed() {
  const arrived = Promise.withResolvers<void>()
  const response = Promise.withResolvers<Response>()
  unanswered.push(() => response.resolve(problem(500, 'INTERNAL_ERROR')))
  return {
    respond: async () => {
      arrived.resolve()
      return (await response.promise).clone()
    },
    arrived: arrived.promise,
    answer: response.resolve,
  }
}
