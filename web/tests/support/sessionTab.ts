import { vi } from 'vitest'
import type { ApiError } from '../../src/api/apiError'
import type { Backend } from './backend'

export const credentials = { email: 'name@example.com', password: 'pass1234' }
export const account = { email: 'new@example.com', password: 'pass1234', displayName: '이서연' }

/** 탭 하나. 모듈을 새로 불러와 메모리를 다른 탭과 나누지 않는다. 저장소와 잠금은 함께 쓴다. */
export async function openTab() {
  vi.resetModules()
  const session = await import('../../src/api/session')
  const marks = await import('../../src/api/sessionMarks')
  const { request } = await import('../../src/api/request')
  return { ...session, ...marks, request }
}

export type Tab = Awaited<ReturnType<typeof openTab>>

export async function openSignedInTab() {
  const tab = await openTab()
  await tab.login(credentials)
  return tab
}

export async function openSignedUpTab() {
  const tab = await openTab()
  await tab.signup(account)
  return tab
}

/** 새 로그인을 시작하는 두 길. 세션 계층은 둘을 같은 순서로 다룬다. */
export const starts = [
  {
    name: '로그인',
    path: '/auth/login',
    send: (tab: Tab) => tab.login(credentials),
    respond: (backend: Backend, response: Backend['loginResponse']) => void (backend.loginResponse = response),
    requests: (backend: Backend) => backend.requests.login,
    user: 'user-1',
  },
  {
    name: '가입',
    path: '/auth/signup',
    send: (tab: Tab) => tab.signup(account),
    respond: (backend: Backend, response: Backend['signupResponse']) => void (backend.signupResponse = response),
    requests: (backend: Backend) => backend.requests.signup,
    user: 'new-user',
  },
]

export async function errorOf(promise: Promise<unknown>): Promise<ApiError> {
  return promise.then(
    () => {
      throw new Error('실패해야 하는 요청이 성공했다')
    },
    (error: ApiError) => error,
  )
}

/** 요청을 중단해도 응답이 오는 경우까지 보려고, 중단 신호를 무시하는 fetch로 바꾼다. */
export function answerRegardlessOfAbort(path: string) {
  const arrived = Promise.withResolvers<AbortSignal>()
  const answer = Promise.withResolvers<Response>()
  const realFetch = fetch
  vi.stubGlobal('fetch', (input: string, init: RequestInit) => {
    if (input !== `/api/v1${path}`) return realFetch(input, init)
    arrived.resolve(init.signal!)
    return answer.promise
  })
  return { arrived: arrived.promise, with: answer.resolve }
}

/** 요청이 서버를 다녀올 만큼 기다린다. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

/** 다시 보내는 로그아웃이 표시를 읽기까지 기다렸다가 서버를 다녀올 만큼 기다린다. */
export const settleResent = () => new Promise((resolve) => setTimeout(resolve, 200))

/** 시계를 멈춘다. 요청은 흐른다. */
export const stopClock = () => void vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

/** 멈춘 시계를 `ms`만큼 보낸다. 실제 시간이 걸리는 가짜 서버의 일이 끝나기를 앞뒤로 기다린다. */
export async function pass(ms: number) {
  await settleServer()
  await vi.advanceTimersByTimeAsync(ms)
  await settleServer()
}

async function settleServer() {
  for (let turn = 0; turn < 30; turn += 1) await new Promise((resolve) => setImmediate(resolve))
}
