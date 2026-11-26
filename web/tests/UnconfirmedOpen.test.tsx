import { act, cleanup, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { ledgerNameOf, meOf, startBackend, type Backend } from './support/backend'
import { setDeviceClock } from './support/clock'
import { goOnline, startOffline } from './support/connection'
import { copyKeys, forgetRecord, forgetUser, loginRecord, meCopy, seedLogin, seedMeCopy, setMarks } from './support/device'
import { startMockServer } from './support/mockServer'
import { openApp } from './support/openApp'
import { problem } from './support/problem'
import { installMatchMedia } from './support/viewport'
import { removeLocks } from './support/webLocks'

/*
 * 연결 없이 앱을 열 때의 로그인 확인(architect·security 결정 2026-11-26, #234). 화면에서 본다.
 * 여섯 조건을 모두 만족하면 '확인하지 못한 로그인'으로 열어 그 사용자의 사본, 공통 틀, 빠른 입력을 보인다.
 * 하나라도 어긋나면 지금처럼 '확인하지 못함'이고 어떤 사본도 화면에 없다.
 */

vi.stubGlobal('scrollTo', vi.fn())

const server = startMockServer()
let backend: Backend

const DAY = 24 * 60 * 60 * 1000
const NOW = '2026-11-26T12:00:00+09:00'
const now = Date.parse(NOW)

/** 기기의 사본이 서버의 값과 다르게 해 어느 쪽이 보이는지 안다 */
const copiedMe = {
  ...meOf('user-1'),
  displayName: '사본의 이름',
  ledgers: [{ id: meOf('user-1').ledgers[0].id, name: '사본의 장부', role: 'OWNER' }],
}

beforeEach(() => {
  backend = startBackend(server)
  sessionStorage.clear()
  localStorage.clear()
  setDeviceClock(NOW)
  // 휴대폰 폭이다. 공통 틀은 하단 탭(주 메뉴)이고 사이드바는 숨는다
  installMatchMedia(390)
})

afterEach(() => {
  cleanup()
  removeLocks()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.stubGlobal('scrollTo', vi.fn())
})

const failed = '불러오지 못했어요.'

/** navigator.storage(jsdom에는 없다)를 둔다. 테스트가 끝나면 걷는다. */
function stubStorage(storage: Pick<StorageManager, 'persisted' | 'persist'>) {
  Object.defineProperty(navigator, 'storage', { configurable: true, value: storage })
  onTestFinished(() => {
    delete (navigator as { storage?: unknown }).storage
  })
}
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)))

/** 기록, 표시, 내 정보 사본이 모두 맞는 기기 */
async function seedDevice() {
  await seedLogin({ confirmedAt: now - DAY, loggedInAt: now - 10 * DAY })
  await seedMeCopy('user-1', copiedMe, now - DAY)
}

async function openWithRefresh(respond: () => Response | Promise<Response>, path = '/home') {
  backend.refreshResponse = respond
  return openApp(path)
}

/** 공통 틀과 사본의 장부가 보인다 */
async function expectFrame() {
  expect(await screen.findByRole('navigation', { name: '주 메뉴' })).toBeTruthy()
  expect(screen.getAllByText('사본의 장부').length).toBeGreaterThan(0)
  expect(screen.getAllByRole('link', { name: '거래 입력' }).length).toBeGreaterThan(0)
  expect(screen.queryByRole('heading', { level: 1, name: failed })).toBeNull()
}

/** '확인하지 못함'이고 사본의 값이 화면 어디에도 없다 */
async function expectUnknown() {
  expect(await screen.findByRole('heading', { level: 1, name: failed })).toBeTruthy()
  await settle()
  const text = document.body.textContent ?? ''
  for (const copied of ['사본의 장부', '사본의 이름', ledgerNameOf('user-1')]) expect(text).not.toContain(copied)
  expect(screen.queryByRole('navigation', { name: '주 메뉴' })).toBeNull()
}

describe('연결 없음과 같은 실패로 열면', () => {
  it.each<[string, () => Response]>([
    ['연결 오류', () => HttpResponse.error()],
    ['서버 오류(5xx)', () => problem(500, 'INTERNAL_ERROR')],
    ['프록시의 502(본문을 읽을 수 없음)', () => new HttpResponse('Bad Gateway', { status: 502 })],
    ['429', () => problem(429, 'TOO_MANY_REQUESTS')],
    ['우리 모양이 아닌 4xx(포털 페이지 등)', () => new HttpResponse('<html>로그인</html>', { status: 401 + 2 })],
    ['2xx인데 읽을 수 없는 본문', () => new HttpResponse('<html>로그인</html>', { status: 200 })],
  ])('여섯 조건을 모두 만족하면 그 사용자의 사본으로 공통 틀과 빠른 입력을 보인다: %s', async (_, respond) => {
    await seedDevice()
    await openWithRefresh(respond)
    await expectFrame()
  })

  it('연결이 없는 기기(브라우저가 offline)에서도 열린다', async () => {
    await seedDevice()
    startOffline()
    await openWithRefresh(() => HttpResponse.error())
    await expectFrame()
  })

  it('빠른 입력이 열린다', async () => {
    await seedDevice()
    const { user } = await openWithRefresh(() => HttpResponse.error())
    await expectFrame()
    await user.click(screen.getAllByRole('link', { name: '거래 입력' })[0])
    expect(await screen.findByRole('heading', { level: 1, name: '거래 입력' })).toBeTruthy()
    // 화면 코드를 받는 동안의 틀(#251)에도 같은 제목이 있으므로 칸이 나오기를 기다린다
    expect(await screen.findByLabelText('금액')).toBeTruthy()
  })

  it('확인되기 전(연결 없음)에는 저장해도 토큰 없이 보내지 않는다(기록의 사용자를 요청의 사용자로 쓰지 않는다)', async () => {
    const posted: string[] = []
    server.use(
      http.post('/api/v1/ledgers/:ledgerId/transactions', ({ request }) => {
        posted.push(request.headers.get('Authorization') ?? '토큰 없음')
        return HttpResponse.json({}, { status: 201 })
      }),
    )
    await seedDevice()
    const { user } = await openWithRefresh(() => HttpResponse.error(), '/transactions/new')
    await screen.findByRole('heading', { level: 1, name: '거래 입력' })
    await user.type(await screen.findByLabelText('금액'), '12000')
    await user.click(screen.getByRole('button', { name: '저장' }))
    await settle()
    expect(posted).toEqual([])
  })

  it.each<[string, () => void | Promise<void>]>([
    ['1. 그 뒤 다른 로그인이 있었다', () => setMarks({ login: 'login-mark-2' })],
    ['1. 그 뒤 로그아웃했다', () => setMarks({ logout: 'logout-mark-2' })],
    ['3. 확인한 때부터 30일이 지났다', () => setDeviceClock('2026-12-25T12:00:00+09:00')],
    ['3. 로그인한 때부터 180일이 지났다', () => seedLogin({ confirmedAt: now - DAY, loggedInAt: now - 180 * DAY })],
    [
      '3. 로그인한 시각이 확인한 시각보다 뒤다',
      () => seedLogin({ confirmedAt: now - 2 * DAY, loggedInAt: now - DAY }),
    ],
    ['5. 기록이 없다', forgetRecord],
    ['5. 기기 저장소를 쓸 수 없다', () => vi.stubGlobal('indexedDB', undefined)],
    ['6. 그 사용자의 내 정보 사본이 없다', () => forgetUser('user-1')],
    [
      '6. 사본이 기록의 사용자의 것이 아니다',
      async () => {
        await forgetUser('user-1')
        await seedMeCopy('user-2', { ...copiedMe, ...meOf('user-2'), displayName: '사본의 이름' })
      },
    ],
  ])('하나라도 어긋나면 확인하지 못함이고 어떤 사본도 보이지 않는다: %s', async (_, breakIt) => {
    await seedDevice()
    await breakIt()
    await openWithRefresh(() => HttpResponse.error())
    await expectUnknown()
  })

  it('2. 로그아웃 대기가 있으면 갱신하지 않고 지금처럼 로그인 화면으로 가며 사본을 보이지 않는다', async () => {
    await seedDevice()
    localStorage.setItem('akkimpyo-logout-done', 'older')
    await openWithRefresh(() => HttpResponse.error())
    expect(await screen.findByRole('heading', { level: 1, name: '로그인' })).toBeTruthy()
    await settle()
    expect(document.body.textContent).not.toContain('사본의 장부')
  })

  it('4. 탭이 표시를 나누지 못하면(저장소가 막힘) 확인하지 못함이다', async () => {
    await seedDevice()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('막힘', 'SecurityError')
    })
    await openWithRefresh(() => HttpResponse.error())
    await expectUnknown()
  })
})

describe('연결 없음과 같은 실패가 아니면', () => {
  it.each<[string, () => Response]>([
    ['problem+json 400', () => problem(400, 'VALIDATION_FAILED', { fieldErrors: [{ field: '', code: 'REQUIRED' }] })],
    ['problem+json 403 ORIGIN_NOT_ALLOWED', () => problem(403, 'ORIGIN_NOT_ALLOWED')],
  ])('우리 서버가 거절한 것(%s)은 확인하지 못함이고 어떤 사본도 보이지 않는다', async (_, respond) => {
    await seedDevice()
    await openWithRefresh(respond)
    await expectUnknown()
  })

  it('401이면 로그인 화면이고 사본을 보이지 않는다', async () => {
    await seedDevice()
    await openWithRefresh(() => problem(401, 'UNAUTHENTICATED'))
    expect(await screen.findByRole('heading', { level: 1, name: '로그인' })).toBeTruthy()
    expect(document.body.textContent).not.toContain('사본의 장부')
    await settle()
    expect(await loginRecord()).toBeUndefined()
  })
})

describe('확인하지 못한 로그인으로 연 뒤 연결이 돌아오면', () => {
  async function openUnconfirmed() {
    await seedDevice()
    const opened = await openWithRefresh(() => HttpResponse.error())
    await expectFrame()
    return opened
  }

  /** 서버에 닿게 되고 refresh 쿠키가 `user`의 것인 채로 연결이 돌아온다. */
  function reconnectAs(user: string | undefined) {
    backend.refreshResponse = undefined
    backend.cookieUser = user
    act(() => goOnline())
  }

  it('다른 요청보다 먼저 갱신하고, 같은 사용자면 서버의 내 정보로 바꾼다', async () => {
    await openUnconfirmed()
    const order: string[] = []
    server.events.on('request:start', ({ request }) => order.push(new URL(request.url).pathname))
    reconnectAs('user-1')
    expect(await screen.findAllByText(ledgerNameOf('user-1'))).not.toHaveLength(0)
    expect(order[0]).toBe('/api/v1/auth/refresh')
    expect(screen.queryByText('사본의 장부')).toBeNull()
    server.events.removeAllListeners()
  })

  it('쓰던 입력 화면은 그대로 남는다', async () => {
    await seedDevice()
    const { user } = await openWithRefresh(() => HttpResponse.error(), '/transactions/new')
    await screen.findByRole('heading', { level: 1, name: '거래 입력' })
    await user.type(await screen.findByLabelText('금액'), '12000')
    reconnectAs('user-1')
    await waitFor(() => expect(backend.requests.me).toEqual(['user-1']))
    await settle()
    expect((screen.getByLabelText('금액') as HTMLInputElement).value).toBe('12,000')
  })

  it('연 때 쓰던 빠른 입력을 확인된 뒤 저장하면 그 사용자(토큰의 sub)로 보낸다', async () => {
    const posted: string[] = []
    server.use(
      http.post('/api/v1/ledgers/:ledgerId/transactions', async ({ request }) => {
        posted.push(backend.userOf(request) ?? '만료')
        const body = (await request.json()) as { id: string; type: string }
        return HttpResponse.json(
          { id: body.id, type: body.type, status: 'POSTED', version: 1, deletedAt: null },
          { status: 201 },
        )
      }),
    )
    await seedDevice()
    const { user } = await openWithRefresh(() => HttpResponse.error(), '/transactions/new')
    await screen.findByRole('heading', { level: 1, name: '거래 입력' })
    await user.type(await screen.findByLabelText('금액'), '12000')
    reconnectAs('user-1')
    // 확인된 뒤 계좌 목록을 다시 받아 기본 계좌가 채워진다
    await waitFor(() => expect(backend.requests.accounts).toContain('user-1'))
    await settle()
    await user.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(posted).toEqual(['user-1']))
  })

  it('갱신이 401이면 기록을 지우고 "로그인이 풀렸어요" 로그인 화면으로 간다', async () => {
    await openUnconfirmed()
    reconnectAs(undefined)
    expect(await screen.findByText('로그인이 풀렸어요. 다시 로그인해 주세요.')).toBeTruthy()
    await settle()
    expect(await loginRecord()).toBeUndefined()
  })

  it('갱신된 사용자가 다르면 앞 사용자의 사본을 지우고 그 사용자로 다시 연다', async () => {
    await openUnconfirmed()
    reconnectAs('user-2')
    expect(await screen.findAllByText(ledgerNameOf('user-2'))).not.toHaveLength(0)
    await settle()
    expect(document.body.textContent).not.toContain('사본의 장부')
    expect((await copyKeys()).filter(([owner]) => owner === 'user-1')).toEqual([])
  })
})

describe('확인하지 못한 로그인으로 연 탭에서', () => {
  it('다른 탭이 로그아웃하면 로그인 화면으로 간다', async () => {
    await seedDevice()
    await openWithRefresh(() => HttpResponse.error())
    await expectFrame()
    localStorage.setItem('akkimpyo-logout', 'logout-mark-2')
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'akkimpyo-logout' })))
    expect(await screen.findByRole('heading', { level: 1, name: '로그인' })).toBeTruthy()
    expect(document.body.textContent).not.toContain('사본의 장부')
  })

  it('화면이 다시 보일 때 기록이 없어졌으면(다른 탭의 401) 로그인 화면으로 간다', async () => {
    await seedDevice()
    await openWithRefresh(() => HttpResponse.error())
    await expectFrame()
    await forgetRecord()
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(await screen.findByText('로그인이 풀렸어요. 다시 로그인해 주세요.')).toBeTruthy()
  })

  it('로그아웃하면 기록과 사본을 지우고 로그인 화면으로 간다(연결이 없어도)', async () => {
    await seedDevice()
    backend.logoutResponse = () => HttpResponse.error()
    const { user } = await openWithRefresh(() => HttpResponse.error(), '/more')
    await expectFrame()
    await user.click(await screen.findByRole('button', { name: '로그아웃' }))
    expect(await screen.findByRole('heading', { level: 1, name: '로그인' })).toBeTruthy()
    await settle()
    expect(await loginRecord()).toBeUndefined()
    expect(await copyKeys()).toEqual([])
  })
})

describe('기기 저장의 때', () => {
  it('로그인한 상태로 내 정보를 받으면 그 사용자의 사본으로 통째로 남긴다', async () => {
    backend.cookieUser = 'user-1'
    await openApp('/home')
    await screen.findAllByText(ledgerNameOf('user-1'))
    await settle()
    expect(await meCopy('user-1')).toEqual({ data: meOf('user-1'), receivedAt: now })
  })

  it('앱을 열 때 마지막으로 확인한 때부터 30일이 지난 사본을 지운다', async () => {
    await seedLogin({ confirmedAt: now - 30 * DAY })
    await seedMeCopy('user-1', copiedMe, now - 30 * DAY)
    await openWithRefresh(() => problem(401, 'UNAUTHENTICATED'))
    await screen.findByRole('heading', { level: 1, name: '로그인' })
    await settle()
    expect((await copyKeys()).filter(([, , kind]) => kind !== 'meta')).toEqual([])
  })

  it('로그인하면 브라우저에 저장을 지우지 말아 달라고 요청한다', async () => {
    const persist = vi.fn(async () => true)
    stubStorage({ persisted: async () => false, persist })
    backend.cookieUser = 'user-1'
    await openApp('/home')
    await screen.findAllByText(ledgerNameOf('user-1'))
    await waitFor(() => expect(persist).toHaveBeenCalled())
  })

  it('이미 저장 유지가 받아들여졌으면 다시 요청하지 않는다', async () => {
    const persist = vi.fn(async () => true)
    stubStorage({ persisted: async () => true, persist })
    backend.cookieUser = 'user-1'
    await openApp('/home')
    await screen.findAllByText(ledgerNameOf('user-1'))
    await settle()
    expect(persist).not.toHaveBeenCalled()
  })
})
