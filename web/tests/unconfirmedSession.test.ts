import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { meOf, startBackend, type Backend } from './support/backend'
import { setDeviceClock } from './support/clock'
import { copyKeys, forgetRecord, loginRecord, seedLogin, seedMeCopy, setMarks } from './support/device'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import { credentials, errorOf, openSignedInTab, openTab, settle, type Tab } from './support/sessionTab'

/*
 * 마지막으로 확인한 로그인 기록과 '확인하지 못한 로그인'(architect·security 결정 2026-11-26, #234)의 세션 계층.
 * 화면은 UnconfirmedOpen.test.tsx가 본다.
 */

const server = startMockServer()
let backend: Backend
const DAY = 24 * 60 * 60 * 1000
const NOW = '2026-11-26T12:00:00+09:00'
const now = Date.parse(NOW)

beforeEach(() => {
  backend = startBackend(server)
  localStorage.clear()
  setDeviceClock(NOW)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** 기록을 쓰는 일은 기다리지 않으므로 끝날 만큼 기다린다. */
const written = () => settle()

/** 갱신이 응답 없이 실패하는 기기에서 탭을 열고 앱을 열 때의 확인 결과를 받는다. */
async function openOffline(usable: (user: string) => Promise<boolean> = async () => true) {
  backend.refreshResponse = () => HttpResponse.error()
  const tab = await openTab()
  const error = await errorOf(tab.restoreSession())
  const user = await tab.openUnconfirmed(error, usable)
  backend.refreshResponse = undefined
  return { tab, user, error }
}

/** 기록, 표시, 내 정보 사본이 모두 맞는 기기 */
async function seedDevice(userId = 'user-1') {
  await seedLogin({ userId, confirmedAt: now - DAY, loggedInAt: now - 10 * DAY })
  await seedMeCopy(userId)
}

function endsOf(tab: Tab) {
  const ends: string[] = []
  tab.onSessionEnded((end) => ends.push(end))
  return ends
}

describe('기록을 쓰는 때', () => {
  it('로그인을 받아들이면 그 사용자, 지금, 그때의 표시를 적는다', async () => {
    await openSignedInTab()
    await written()
    expect(await loginRecord()).toEqual({
      userId: 'user-1',
      loggedInAt: now,
      confirmedAt: now,
      loginValue: localStorage.getItem('akkimpyo-login'),
      logoutValue: null,
    })
  })

  it('가입을 받아들여도 적는다', async () => {
    const tab = await openTab()
    await tab.signup({ email: 'new@example.com', password: 'pass1234', displayName: '이서연' })
    await written()
    expect(await loginRecord()).toMatchObject({ userId: 'new-user', loggedInAt: now, confirmedAt: now })
  })

  it('갱신을 받아들이면 확인 시각을 고치고 같은 로그인의 로그인 시각은 이어받는다', async () => {
    await openSignedInTab()
    await written()
    setDeviceClock('2026-11-27T09:00:00+09:00')
    const tab = await openTab()
    expect(await tab.restoreSession()).toBe(true)
    await written()
    expect(await loginRecord()).toMatchObject({
      userId: 'user-1',
      loggedInAt: now,
      confirmedAt: Date.parse('2026-11-27T09:00:00+09:00'),
    })
  })

  it('로그아웃한 뒤 늦게 온 로그인 응답은 받아들이지 않으므로 적지 않는다', async () => {
    const answer = Promise.withResolvers<Response>()
    backend.loginResponse = () => answer.promise
    const tab = await openTab()
    const login = errorOf(tab.login(credentials))
    await settle()
    tab.logout()
    answer.resolve(backend.issue('user-1'))
    await login
    await written()
    expect(await loginRecord()).toBeUndefined()
  })

  it('다른 사용자가 로그인하면 기록을 덮어쓰고 앞 사용자의 사본을 지운다', async () => {
    await seedDevice('user-1')
    backend.loginUser = 'user-2'
    await openSignedInTab()
    await written()
    expect(await loginRecord()).toMatchObject({ userId: 'user-2' })
    expect(await copyKeys()).toEqual([['user-2', '', 'meta']])
  })

  it('기록에 토큰을 넣지 않는다', async () => {
    await openSignedInTab()
    await written()
    expect(JSON.stringify(await loginRecord())).not.toContain('token-')
  })
})

describe('기록을 지우는 때', () => {
  it('로그아웃하면 기록과 그 사용자의 사본을 지운다', async () => {
    const tab = await openSignedInTab()
    await written()
    await seedMeCopy('user-1')
    await seedMeCopy('user-2')
    tab.logout()
    await written()
    expect(await loginRecord()).toBeUndefined()
    expect(await copyKeys()).toEqual([['user-2', '', 'me']])
  })

  it('연결 없이 로그아웃해도(로그아웃 대기) 기록을 지운다', async () => {
    backend.logoutResponse = () => HttpResponse.error()
    const tab = await openSignedInTab()
    await written()
    tab.logout()
    await written()
    expect(tab.pendingLogout()).toBeDefined()
    expect(await loginRecord()).toBeUndefined()
  })

  it('로그아웃은 다른 무엇보다 먼저 기록 지우기를 시작한다', async () => {
    const tab = await openSignedInTab()
    await written()
    const order: string[] = []
    const realSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      order.push(`표시 ${key}`)
      return realSetItem.call(this, key, value)
    })
    const realTransaction = IDBDatabase.prototype.transaction
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args) {
      order.push(`저장소 ${[args[0]].flat().join(',')}`)
      return realTransaction.apply(this, args)
    })
    tab.logout()
    await written()
    expect(order[0]).toBe('저장소 login')
  })

  it('갱신이 401이면 그 탭이 기록을 지운다(사본은 남긴다)', async () => {
    const tab = await openSignedInTab()
    await written()
    await seedMeCopy('user-1')
    backend.expireTokens()
    backend.cookieUser = undefined
    await errorOf(tab.request('/me'))
    await written()
    expect(await loginRecord()).toBeUndefined()
    expect(await copyKeys()).toContainEqual(['user-1', '', 'me'])
  })

  it('늦게 온 401은 그사이 다른 탭의 로그인이 쓴 기록을 지우지 않는다', async () => {
    const first = await openSignedInTab()
    await written()
    backend.expireTokens()
    const answer = Promise.withResolvers<Response>()
    backend.refreshResponse = () => answer.promise
    const failed = errorOf(first.request('/me'))
    await settle()
    // 다른 탭이 로그인해 새 기록을 쓴다
    backend.refreshResponse = undefined
    backend.loginUser = 'user-2'
    await openSignedInTab()
    await written()
    answer.resolve(problem(401, 'UNAUTHENTICATED'))
    await failed
    await written()
    expect(await loginRecord()).toMatchObject({ userId: 'user-2' })
  })
})

describe('앱을 열 때 갱신이 실패하면', () => {
  const noConnection: [string, () => Response][] = [
    ['연결 오류', () => HttpResponse.error()],
    ['서버 오류(5xx)', () => problem(500, 'INTERNAL_ERROR')],
    ['프록시의 5xx(본문을 읽을 수 없음)', () => new HttpResponse('Bad Gateway', { status: 502 })],
    ['429', () => problem(429, 'TOO_MANY_REQUESTS')],
    ['우리 모양이 아닌 4xx(포털 페이지 등)', () => new HttpResponse('<html>로그인</html>', { status: 403 })],
    ['2xx인데 읽을 수 없는 본문', () => new HttpResponse('<html>로그인</html>', { status: 200 })],
  ]

  describe.each(noConnection)('연결 없음과 같은 실패: %s', (_, respond) => {
    async function open() {
      backend.refreshResponse = respond
      const tab = await openTab()
      const error = await errorOf(tab.restoreSession())
      return { tab, error }
    }

    it('여섯 조건을 모두 만족하면 기록의 사용자로 연다', async () => {
      await seedDevice()
      const { tab, error } = await open()
      expect(await tab.openUnconfirmed(error, async () => true)).toBe('user-1')
      expect(tab.sessionUserId()).toBe('user-1')
    })

    it.each<[string, () => void | Promise<void>]>([
      ['1. 그 뒤 다른 로그인이 있었다', () => setMarks({ login: 'login-mark-2' })],
      ['1. 그 뒤 로그아웃했다', () => setMarks({ logout: 'logout-mark-2' })],
      ['2. 로그아웃 대기가 있다', () => localStorage.setItem('akkimpyo-logout-done', 'older')],
      ['3. 확인한 때부터 30일이 지났다', () => setDeviceClock('2026-12-25T12:00:00+09:00')],
      [
        '3. 로그인한 때부터 180일이 지났다',
        () => seedLogin({ confirmedAt: now - DAY, loggedInAt: now - 180 * DAY }),
      ],
      [
        '4. 탭이 표시를 나누지 못한다',
        () => {
          vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new DOMException('막힘', 'SecurityError')
          })
        },
      ],
      ['5. 기록이 없다', forgetRecord],
      ['5. 저장소를 읽지 못한다', () => vi.stubGlobal('indexedDB', undefined)],
      ['6. 그 사용자의 계정별 저장(내 정보 사본)을 쓸 수 없다', () => {}],
    ])('어긋나면 열지 않는다: %s', async (name, breakIt) => {
      await seedDevice()
      const { tab, error } = await open()
      await breakIt()
      const usable = async () => !name.startsWith('6.')
      expect(await tab.openUnconfirmed(error, usable)).toBeUndefined()
      expect(tab.sessionUserId()).toBeUndefined()
    })
  })

  it.each<[string, () => Response]>([
    ['problem+json 400', () => problem(400, 'VALIDATION_FAILED', { fieldErrors: [{ field: '', code: 'REQUIRED' }] })],
    ['problem+json 403 ORIGIN_NOT_ALLOWED', () => problem(403, 'ORIGIN_NOT_ALLOWED')],
  ])('우리 서버가 거절한 것(%s)은 확인하지 못함이다', async (_, respond) => {
    await seedDevice()
    backend.refreshResponse = respond
    const tab = await openTab()
    const error = await errorOf(tab.restoreSession())
    expect(await tab.openUnconfirmed(error, async () => true)).toBeUndefined()
  })

  it('탭 사이 잠금을 15초 기다리다 못 얻은 실패는 확인하지 못함이다(security·architect Q2)', async () => {
    await seedDevice()
    const tab = await openTab()
    // 탭이 쓰는 모듈의 오류여야 한다(openTab이 모듈을 새로 불러온다)
    const { ApiError } = await import('../src/api/apiError')
    expect(await tab.openUnconfirmed(ApiError.lockTimeout(), async () => true)).toBeUndefined()
    expect(await tab.openUnconfirmed(ApiError.timeout(), async () => true)).toBe('user-1')
  })

  it('401이면 로그인이 필요하고 기록을 지운다', async () => {
    await seedDevice()
    const tab = await openTab()
    expect(await tab.restoreSession()).toBe(false)
    await written()
    expect(await loginRecord()).toBeUndefined()
  })

  it('확인하는 사이에 이 탭에서 로그인했으면 열지 않는다', async () => {
    await seedDevice()
    const { tab, error } = await (async () => {
      backend.refreshResponse = () => HttpResponse.error()
      const opened = await openTab()
      return { tab: opened, error: await errorOf(opened.restoreSession()) }
    })()
    backend.refreshResponse = undefined
    await tab.login(credentials)
    expect(await tab.openUnconfirmed(error, async () => true)).toBeUndefined()
    expect(tab.sessionUserId()).toBe('user-1')
  })
})

describe('확인하지 못한 로그인으로 연 뒤', () => {
  beforeEach(async () => {
    await seedDevice()
    backend.cookieUser = 'user-1'
  })

  it('기기 데이터의 주인은 기록의 사용자이고, 요청의 사용자(토큰의 sub)는 없다', async () => {
    const { tab, user } = await openOffline()
    expect(user).toBe('user-1')
    expect(tab.sessionUserId()).toBe('user-1')
    expect(tab.currentUserId()).toBeUndefined()
  })

  it('요청은 토큰 없이 보내지 않고, 다른 요청보다 먼저 갱신해 같은 사용자면 로그인 상태가 된다', async () => {
    const { tab } = await openOffline()
    const confirmed = vi.fn()
    tab.onSessionConfirmed(confirmed)
    const order: string[] = []
    server.events.on('request:start', ({ request }) => order.push(new URL(request.url).pathname))
    expect(await tab.request('/me')).toEqual(meOf('user-1'))
    expect(order).toEqual(['/api/v1/auth/refresh', '/api/v1/me'])
    expect(backend.requests.me).toEqual(['user-1'])
    expect(tab.currentUserId()).toBe('user-1')
    expect(confirmed).toHaveBeenCalledTimes(1)
    server.events.removeAllListeners()
  })

  it('같은 사용자로 갱신되면 기록의 확인 시각을 고치고 로그인 시각은 이어받는다', async () => {
    const { tab } = await openOffline()
    await tab.confirmSession()
    await written()
    expect(await loginRecord()).toMatchObject({ userId: 'user-1', loggedInAt: now - 10 * DAY, confirmedAt: now })
  })

  it('갱신이 다시 연결 없음과 같은 실패면 그 오류로 끝나고 확인하지 못한 로그인으로 남는다', async () => {
    const { tab } = await openOffline()
    backend.refreshResponse = () => HttpResponse.error()
    const error = await errorOf(tab.request('/me'))
    expect(error.kind).toBe('connection')
    expect(backend.requests.me).toEqual([])
    expect(tab.sessionUserId()).toBe('user-1')
  })

  it('갱신이 401이면 기록을 지우고 로그인이 풀린 것으로 끝낸다', async () => {
    const { tab } = await openOffline()
    const ends = endsOf(tab)
    backend.cookieUser = undefined
    const error = await errorOf(tab.request('/me'))
    await written()
    expect(error.status).toBe(401)
    expect(ends).toEqual(['ended'])
    expect(await loginRecord()).toBeUndefined()
    expect(tab.sessionUserId()).toBeUndefined()
  })

  it('갱신된 사용자가 다르면 앞 사용자의 요청은 보내지 않고 다시 확인하게 끝내며, 앞 사용자의 사본을 지운다', async () => {
    const { tab } = await openOffline()
    const ends = endsOf(tab)
    backend.cookieUser = 'user-2'
    const error = await errorOf(tab.request('/me'))
    await written()
    expect(error.kind).toBe('timeout')
    expect(ends).toEqual(['replaced'])
    expect(backend.requests.me).toEqual([])
    expect(await loginRecord()).toMatchObject({ userId: 'user-2' })
    expect(await copyKeys()).toEqual([['user-2', '', 'meta']])
    // 다시 확인하면 새 사용자로 열린다
    expect(await tab.restoreSession()).toBe(true)
    expect(tab.currentUserId()).toBe('user-2')
  })

  it('다음 요청 직전에 기록이 없어졌으면(다른 탭의 401) 갱신도 요청도 보내지 않고 로그인이 풀린 것으로 끝낸다', async () => {
    const { tab } = await openOffline()
    const ends = endsOf(tab)
    await forgetRecord()
    const refreshes = backend.requests.refresh.length
    const error = await errorOf(tab.request('/me'))
    expect(error.status).toBe(401)
    expect(ends).toEqual(['ended'])
    expect(backend.requests.refresh).toHaveLength(refreshes)
  })

  it('연결이 돌아왔을 때(confirmSession)도 기록이 없으면 갱신하지 않고 끝낸다', async () => {
    const { tab } = await openOffline()
    const ends = endsOf(tab)
    await forgetRecord()
    const refreshes = backend.requests.refresh.length
    await tab.confirmSession()
    expect(ends).toEqual(['ended'])
    expect(backend.requests.refresh).toHaveLength(refreshes)
  })

  it('화면이 다시 보일 때(recheckUnconfirmed) 기록이 없거나 기한이 지났으면 끝낸다', async () => {
    const { tab } = await openOffline()
    const ends = endsOf(tab)
    await tab.recheckUnconfirmed()
    expect(ends).toEqual([])
    setDeviceClock('2026-12-26T12:00:00+09:00')
    await tab.recheckUnconfirmed()
    expect(ends).toEqual(['ended'])
  })

  it('다른 탭에서 로그아웃하면 로그아웃으로 끝낸다', async () => {
    const { tab } = await openOffline()
    const ends = endsOf(tab)
    localStorage.setItem('akkimpyo-logout', 'logout-mark-2')
    tab.noticeLogout()
    expect(ends).toEqual(['logged-out'])
  })

  it('다른 탭에서 로그인하면 다시 확인하게 끝낸다', async () => {
    const { tab } = await openOffline()
    const ends = endsOf(tab)
    localStorage.setItem('akkimpyo-login', 'login-mark-2')
    tab.noticeLogout()
    expect(ends).toEqual(['replaced'])
  })

  it('브라우저가 보관했다 되살리면 조건을 다시 보고, 어긋나면 끝낸다', async () => {
    const { tab } = await openOffline()
    const ends = endsOf(tab)
    tab.suspendSession()
    await tab.resumeSession()
    expect(ends).toEqual([])
    tab.suspendSession()
    setDeviceClock('2026-12-26T12:00:00+09:00')
    await tab.resumeSession()
    expect(ends).toEqual(['ended'])
  })

  it('연결 없이 로그아웃해도 기록과 그 사용자의 기기 데이터를 지우고 로그아웃으로 끝낸다', async () => {
    const { tab } = await openOffline()
    backend.logoutResponse = () => HttpResponse.error()
    const ends = endsOf(tab)
    tab.logout()
    await written()
    expect(ends).toEqual(['logged-out'])
    expect(await loginRecord()).toBeUndefined()
    expect(await copyKeys()).toEqual([])
    expect(tab.pendingLogout()).toBeDefined()
  })

  it.each<[string, string, number]>([
    ['보내는 사용자가 갱신된 토큰의 사용자와 같으면 보낸다', 'user-1', 1],
    ['다르면 보내지 않는다', 'user-2', 0],
  ])('보내는 사용자 확인은 토큰의 sub로 한다: %s', async (_, startedBy, sent) => {
    const posted: string[] = []
    server.use(
      http.post('/api/v1/ledgers/:ledgerId/transactions', ({ request }) => {
        posted.push(backend.userOf(request) ?? '만료')
        return HttpResponse.json({}, { status: 201 })
      }),
    )
    const { tab } = await openOffline()
    await tab.request('/ledgers/x/transactions', { method: 'POST', body: {} }, { startedBy }).catch(() => undefined)
    expect(posted).toHaveLength(sent)
  })

  it('확인하지 못한 동안 보내는 사용자를 확인하는 요청은 기록의 사용자를 토큰 대신 쓰지 않는다', async () => {
    const { tab } = await openOffline()
    backend.refreshResponse = () => HttpResponse.error()
    const error = await errorOf(tab.request('/ledgers/x/transactions', { method: 'POST', body: {} }, { startedBy: 'user-1' }))
    expect(error.kind).toBe('connection')
  })
})

describe('지금 로그인한 탭은 그대로다', () => {
  it('토큰이 있는 탭의 요청은 기록을 보지 않는다', async () => {
    const tab = await openSignedInTab()
    vi.stubGlobal('indexedDB', undefined)
    expect(await tab.request('/me')).toEqual(meOf('user-1'))
  })

  it('보내는 사용자 확인: 토큰의 사용자와 다르면 보내지 않는다', async () => {
    const tab = await openSignedInTab()
    let posts = 0
    server.use(
      http.post('/api/v1/ledgers/:ledgerId/transactions', () => {
        posts += 1
        return HttpResponse.json({}, { status: 201 })
      }),
    )
    const error = await errorOf(tab.request('/ledgers/x/transactions', { method: 'POST', body: {} }, { startedBy: 'user-2' }))
    expect(error.kind).toBe('timeout')
    expect(posts).toBe(0)
  })

  it('보내는 사용자를 모르면(undefined) 보내지 않는다', async () => {
    const tab = await openSignedInTab()
    const error = await errorOf(tab.request('/me', {}, { startedBy: undefined }))
    expect(error.kind).toBe('timeout')
    expect(backend.requests.me).toEqual([])
  })

  it('토큰을 갱신해 다시 보낼 때도 보내는 사용자를 다시 본다', async () => {
    const tab = await openSignedInTab()
    backend.expireTokens()
    backend.cookieUser = 'user-1'
    expect(await tab.request('/me', {}, { startedBy: 'user-1' })).toEqual(meOf('user-1'))
  })
})

