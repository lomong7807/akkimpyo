import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { RouteObject } from 'react-router'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { delayed, ledgerNameOf, startBackend, type Backend } from './support/backend'
import { startMockServer } from './support/mockServer'
import { addScreens, openApp } from './support/openApp'
import { problem } from './support/problem'
import { recordDom } from './support/recordDom'
import { createFakeLocks, installLocks, removeLocks, SESSION_LOCK } from './support/webLocks'

vi.stubGlobal('scrollTo', vi.fn())

const server = startMockServer()
let backend: Backend
/** 화면이 그려질 때마다 쓴 값. 그린 뒤 바로 사라져도 남는다. */
let drawn: string[]
/** 화면이 쓰는 캐시 */
let caches: QueryClient[]
/** 다음 목록 응답. 없으면 토큰의 사용자 것을 바로 준다. */
let listResponse: ((user: string) => Response | Promise<Response>) | undefined
let saveResponse: (() => Response | Promise<Response>) | undefined

const RETURN_ADDRESS = 'akkimpyo-return-address'
const ended = '로그인이 풀렸어요. 다시 로그인해 주세요.'
const failed = '불러오지 못했어요.'
const itemOf = (user: string) => `${user}의 거래`
const listOf = (user: string) => HttpResponse.json({ items: [itemOf(user)] })

beforeEach(() => {
  backend = startBackend(server)
  drawn = []
  caches = []
  listResponse = undefined
  saveResponse = undefined
  sessionStorage.clear()
  server.use(
    http.get('/api/v1/list', ({ request }) => {
      const user = backend.userOf(request)
      if (!user) return problem(401, 'UNAUTHENTICATED')
      return listResponse ? listResponse(user) : listOf(user)
    }),
    http.post('/api/v1/list', ({ request }) => {
      const user = backend.userOf(request)
      if (!user) return problem(401, 'UNAUTHENTICATED')
      return saveResponse ? saveResponse() : listOf(user)
    }),
  )
})

afterEach(() => {
  cleanup()
  removeLocks()
})

/** 목록을 받아 보이고, 저장하면 응답을 캐시에 넣는 화면. 앱의 화면이 쓰는 방식이다. */
async function listScreen(): Promise<RouteObject> {
  const { request } = await import('../src/api/request')
  type List = { items: string[] }

  function ListScreen() {
    const queryClient = useQueryClient()
    const [typed, setTyped] = useState('')
    const list = useQuery({ queryKey: ['list'], queryFn: () => request<List>('/list') })
    const save = useMutation({
      mutationFn: () => request<List>('/list', { method: 'POST' }),
      onSuccess: (saved) => queryClient.setQueryData(['list'], saved),
    })
    if (!caches.includes(queryClient)) caches.push(queryClient)
    drawn.push(list.data?.items.join() ?? '')
    return (
      <main>
        <p>{list.data?.items.join()}</p>
        {list.isError && <p>목록을 받지 못함</p>}
        <input aria-label="메모" value={typed} onChange={(event) => setTyped(event.target.value)} />
        <button type="button" onClick={() => void list.refetch()}>
          새로 받기
        </button>
        <button type="button" onClick={() => save.mutate()}>
          저장
        </button>
      </main>
    )
  }
  return { path: '/list', element: <ListScreen /> }
}

const open = (path = '/list') => openApp(path, async (routes) => addScreens([await listScreen()])(routes))
type Opened = Awaited<ReturnType<typeof open>>

const addressOf = ({ router }: Opened) => router.state.location.pathname + router.state.location.search
const press = (user: Opened['user'], name: string) => user.click(screen.getByRole('button', { name }))
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

/** user-1로 로그인해 자기 목록이 보이는 화면 */
async function openAsFirstUser(path?: string) {
  backend.cookieUser = 'user-1'
  const opened = await open(path)
  await screen.findByText(itemOf('user-1'))
  return opened
}

/** 서버가 이 브라우저의 로그인을 폐기했다. 다음 요청에서 알게 된다. */
function revoke() {
  backend.expireTokens()
  backend.cookieUser = undefined
}

async function logIn(user: Opened['user'], as: string) {
  backend.loginUser = as
  await user.type(await screen.findByLabelText('이메일'), 'name@example.com')
  await user.type(screen.getByLabelText('비밀번호'), 'pass1234')
  await press(user, '로그인')
}

describe('쓰던 로그인이 풀리면', () => {
  it('/login으로 보내고 맨 위에 알린다. 원래 주소는 기억한다', async () => {
    const opened = await openAsFirstUser('/list?month=2026-11')
    revoke()
    await press(opened.user, '새로 받기')
    expect((await screen.findByRole('status')).textContent).toBe(ended)
    expect(addressOf(opened)).toBe('/login')
    expect(opened.router.state.historyAction).toBe('REPLACE')
    expect(sessionStorage.getItem(RETURN_ADDRESS)).toBe('/list?month=2026-11')
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it('다시 로그인하면 알림이 사라지고 원래 주소로 돌아간다', async () => {
    const opened = await openAsFirstUser('/list?month=2026-11')
    revoke()
    await press(opened.user, '새로 받기')
    await logIn(opened.user, 'user-1')
    expect(await screen.findByText(itemOf('user-1'))).toBeTruthy()
    expect(addressOf(opened)).toBe('/list?month=2026-11')
    expect(screen.queryByText(ended)).toBeNull()
    expect(sessionStorage.length).toBe(0)
  })

  it('알림은 로그인 화면을 떠날 때까지 남고, 다시 열면 없다', async () => {
    const opened = await openAsFirstUser()
    revoke()
    await press(opened.user, '새로 받기')
    await screen.findByText(ended)
    await opened.user.click(screen.getByLabelText('이메일'))
    await press(opened.user, '로그인')
    expect(screen.getByText(ended)).toBeTruthy()

    await opened.user.click(screen.getByRole('link', { name: '가입' }))
    await screen.findByText('찾을 수 없어요.')
    expect(screen.queryByText(ended)).toBeNull()
    await opened.router.navigate('/login')
    await screen.findByRole('heading', { level: 1, name: '로그인' })
    expect(screen.queryByText(ended)).toBeNull()
  })

  it('캐시를 비우고 진행 중인 요청의 결과도 버린다', async () => {
    const opened = await openAsFirstUser()
    const late = delayed()
    listResponse = late.respond
    await press(opened.user, '새로 받기')
    await late.arrived
    revoke()
    await press(opened.user, '저장')
    await screen.findByText(ended)
    const [cache] = caches
    expect(cache.getQueryCache().getAll()).toEqual([])
    expect(cache.getMutationCache().getAll()).toEqual([])
    late.answer(listOf('user-1'))
    await settle()
    expect(cache.getQueryCache().getAll()).toEqual([])
  })

  it('내 정보가 401이어도 같다. 불러오지 못한 화면이 잠깐도 보이지 않는다', async () => {
    backend.cookieUser = 'user-1'
    backend.meResponse = () => {
      backend.cookieUser = undefined
      return problem(401, 'UNAUTHENTICATED')
    }
    const dom = recordDom()
    const opened = await open()
    expect(await screen.findByText(ended)).toBeTruthy()
    expect(addressOf(opened)).toBe('/login')
    expect(dom.sawText(failed)).toBe(false)
    expect(dom.sawElement('nav, header')).toBe(false)
  })

  it('다시 로그인하기 전에 다른 주소를 열어도 /login이고, 로그인하면 그 주소로 간다', async () => {
    const opened = await openAsFirstUser()
    revoke()
    await press(opened.user, '새로 받기')
    await screen.findByText(ended)
    await opened.router.navigate('/list?month=2026-10')
    await waitFor(() => expect(addressOf(opened)).toBe('/login'))
    await logIn(opened.user, 'user-1')
    expect(await screen.findByText(itemOf('user-1'))).toBeTruthy()
    expect(addressOf(opened)).toBe('/list?month=2026-10')
  })
})

describe('로그인이 풀린 것이 아니면 화면을 그대로 둔다', () => {
  it.each([
    ['갱신이 서버 오류', () => problem(500, 'INTERNAL_ERROR')],
    ['갱신이 연결 오류', () => HttpResponse.error()],
  ])('%s', async (_, respond) => {
    const opened = await openAsFirstUser()
    backend.expireTokens()
    backend.refreshResponse = respond
    await press(opened.user, '새로 받기')
    expect(await screen.findByText('목록을 받지 못함')).toBeTruthy()
    expect(addressOf(opened)).toBe('/list')
    expect(screen.queryByText(ended)).toBeNull()
    expect(screen.getByText(itemOf('user-1'))).toBeTruthy()
  })

  it('토큰이 만료됐을 뿐이면 갱신해 계속 쓴다', async () => {
    const opened = await openAsFirstUser()
    backend.expireTokens()
    await press(opened.user, '새로 받기')
    await waitFor(() => expect(backend.requests.refresh).toHaveLength(2))
    await settle()
    expect(addressOf(opened)).toBe('/list')
    expect(screen.queryByText('목록을 받지 못함')).toBeNull()
  })
})

describe('다른 계정으로 로그인하면', () => {
  /** user-1의 로그인이 풀린 뒤 로그인 화면 */
  async function openAfterEnded() {
    const opened = await openAsFirstUser()
    await opened.user.type(screen.getByLabelText('메모'), '앞 사용자가 쓰던 값')
    const late = delayed()
    listResponse = (user) => (user === 'user-1' ? late.respond() : listOf(user))
    await press(opened.user, '새로 받기')
    await late.arrived
    const lateSave = delayed()
    saveResponse = lateSave.respond
    await press(opened.user, '저장')
    await lateSave.arrived
    revoke()
    // 같은 화면의 다른 요청에서 로그인이 풀린 것을 안다
    saveResponse = undefined
    const { request } = await import('../src/api/request')
    await request('/list').catch(() => {})
    await screen.findByText(ended)
    return { ...opened, late, lateSave }
  }

  it('앞 사용자의 값이 한 번도 그려지지 않고 화면을 처음부터 다시 만든다', async () => {
    const { user } = await openAfterEnded()
    const dom = recordDom()
    drawn = []
    await logIn(user, 'user-2')
    expect(await screen.findByText(itemOf('user-2'))).toBeTruthy()
    expect(await screen.findByLabelText<HTMLInputElement>('메모')).toHaveProperty('value', '')
    expect(new Set(drawn)).toEqual(new Set(['', itemOf('user-2')]))
    expect(dom.sawText('user-1')).toBe(false)
    expect(dom.sawText(ledgerNameOf('user-2'))).toBe(true)
    expect(caches).toHaveLength(2)
    expect(caches[1].getQueryData(['list'])).toEqual({ items: [itemOf('user-2')] })
  })

  it('늦게 도착한 앞 사용자의 응답이 화면과 캐시에 들어가지 않는다', async () => {
    const { user, late, lateSave } = await openAfterEnded()
    await logIn(user, 'user-2')
    await screen.findByText(itemOf('user-2'))
    const dom = recordDom()
    drawn = []
    late.answer(listOf('user-1'))
    lateSave.answer(listOf('user-1'))
    await settle()
    expect(screen.getByText(itemOf('user-2'))).toBeTruthy()
    expect(drawn).toEqual([])
    expect(dom.sawText('user-1')).toBe(false)
    expect(JSON.stringify(caches[1].getQueryCache().getAll().map((query) => query.state.data))).not.toContain('user-1')
  })

  it('늦게 도착해도 로그인하기 전의 로그인 화면에도 나오지 않는다', async () => {
    const { late, lateSave } = await openAfterEnded()
    const dom = recordDom()
    late.answer(listOf('user-1'))
    lateSave.answer(listOf('user-1'))
    await settle()
    expect(dom.sawText('user-1')).toBe(false)
    expect(screen.getByText(ended)).toBeTruthy()
  })
})

describe('로그인이 풀리지 않은 채 같은 탭에서 다른 계정의 로그인이 끝나면', () => {
  /** user-2의 로그인을 보낸 채 로그인 화면을 떠났다 돌아와 user-1로 로그인한 화면. user-2의 응답은 아직 안 왔다. */
  async function openWithLoginInFlight() {
    const opened = await open()
    const slowLogin = delayed()
    backend.loginResponse = slowLogin.respond
    await logIn(opened.user, 'user-2')
    await slowLogin.arrived
    backend.loginResponse = undefined
    await opened.user.click(screen.getByRole('link', { name: '가입' }))
    await opened.router.navigate('/login')
    await logIn(opened.user, 'user-1')
    await screen.findByText(itemOf('user-1'))
    await opened.user.type(screen.getByLabelText('메모'), '앞 사용자가 쓰던 값')
    return { opened, slowLogin }
  }

  it('앞 사용자의 캐시를 비우고 새 사용자의 화면을 처음부터 만든다', async () => {
    const { opened, slowLogin } = await openWithLoginInFlight()
    const [cache] = caches
    const dom = recordDom()
    drawn = []
    slowLogin.answer(backend.issue('user-2'))
    expect(await screen.findByText(itemOf('user-2'))).toBeTruthy()
    expect(addressOf(opened)).toBe('/list')
    expect(screen.getByLabelText<HTMLInputElement>('메모').value).toBe('')
    expect(new Set(drawn)).toEqual(new Set(['', itemOf('user-2')]))
    expect(dom.sawText('user-1')).toBe(false)
    expect(cache.getQueryCache().getAll()).toEqual([])
    expect(screen.queryByText(ended)).toBeNull()
  })

  it('늦게 도착한 앞 사용자의 응답이 화면과 캐시에 들어가지 않는다', async () => {
    const { opened, slowLogin } = await openWithLoginInFlight()
    const late = delayed()
    listResponse = (user) => (user === 'user-1' ? late.respond() : listOf(user))
    await press(opened.user, '새로 받기')
    await late.arrived
    const lateSave = delayed()
    saveResponse = lateSave.respond
    await press(opened.user, '저장')
    await lateSave.arrived

    slowLogin.answer(backend.issue('user-2'))
    await screen.findByText(itemOf('user-2'))
    const dom = recordDom()
    drawn = []
    late.answer(listOf('user-1'))
    lateSave.answer(listOf('user-1'))
    await settle()
    expect(drawn).toEqual([])
    expect(dom.sawText('user-1')).toBe(false)
    expect(caches[1].getQueryData(['list'])).toEqual({ items: [itemOf('user-2')] })
  })
})

describe('다른 탭의 로그인이 이 탭의 갱신에서 잠금을 빼앗으면', () => {
  /** 로그인한 탭이 갱신하는 도중에 다른 탭이 잠금을 빼앗아 `user`로 로그인했다. */
  async function openStolenBy(user: string) {
    const locks = createFakeLocks()
    installLocks(locks)
    const opened = await openAsFirstUser()
    backend.expireTokens()
    const refresh = delayed()
    backend.refreshResponse = refresh.respond
    await press(opened.user, '새로 받기')
    await refresh.arrived
    await locks.request(SESSION_LOCK, { steal: true }, async () => {
      backend.cookieUser = user
    })
    await screen.findByText('목록을 받지 못함')
    backend.refreshResponse = undefined
    return { opened, refresh }
  }

  it('화면이 그대로 남고 로그인 풀림 안내가 없다. 늦게 온 옛 응답도 쓰지 않는다', async () => {
    const { opened, refresh } = await openStolenBy('user-2')
    expect(addressOf(opened)).toBe('/list')
    expect(screen.getByText(itemOf('user-1'))).toBeTruthy()
    expect(screen.queryByText(ended)).toBeNull()
    refresh.answer(problem(401, 'UNAUTHENTICATED'))
    await settle()
    expect(addressOf(opened)).toBe('/list')
    expect(screen.queryByText(ended)).toBeNull()
  })

  it('같은 계정이면 다음 갱신이 성공해 계속 쓰인다', async () => {
    const { opened } = await openStolenBy('user-1')
    await press(opened.user, '새로 받기')
    await waitFor(() => expect(screen.queryByText('목록을 받지 못함')).toBeNull())
    expect(screen.getByText(itemOf('user-1'))).toBeTruthy()
    expect(addressOf(opened)).toBe('/list')
    expect(screen.queryByText(ended)).toBeNull()
  })

  it('다른 계정이면 다음 갱신에서 로그인 풀림으로 /login에 알림과 함께 간다', async () => {
    const { opened } = await openStolenBy('user-2')
    const dom = recordDom()
    await press(opened.user, '새로 받기')
    expect(await screen.findByText(ended)).toBeTruthy()
    expect(addressOf(opened)).toBe('/login')
    expect(dom.sawText('user-2')).toBe(false)
  })
})
