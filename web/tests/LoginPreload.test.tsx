import { cleanup, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { delayed, startBackend, type Backend } from './support/backend'
import { seedLogin } from './support/device'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import { renderRoutes } from './support/renderRoutes'

/*
 * 로그인 화면은 따로 싣는다(#355). 기기에 로그인 기록이 없으면 갱신의 답은 거의 '로그인 필요'이므로, 답을 기다리지 않고 로그인
 * 화면 코드를 받기 시작한다. 로그인 전 첫 방문이 갱신 답 → 조각 받기로 한 박자 늦어지지 않게 한다(architect 조건).
 * 기록이 있으면 홈으로 열릴 것이라 받지 않는다(홈을 그릴 때까지 받는 JS를 늘리지 않는다).
 */

const server = startMockServer()
let backend: Backend

beforeEach(() => {
  backend = startBackend(server)
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(cleanup)

/** 앱을 새로 연다. 테스트 도우미(openApp)와 달리 로그인 화면 코드를 먼저 받아 두지 않고, 앱이 받는지 본다. */
async function open(path: string) {
  vi.resetModules()
  const { routes } = await import('../src/app/routes')
  const { loginScreen } = await import('../src/app/screens')
  const preload = vi.spyOn(loginScreen, 'preload')
  renderRoutes(routes, path)
  return preload
}

describe('로그인 화면 코드를 미리 받기', () => {
  it('기기에 로그인 기록이 없으면 갱신의 답을 기다리지 않고 받기 시작한다', async () => {
    const refresh = delayed()
    backend.refreshResponse = refresh.respond
    const preload = await open('/home')
    await refresh.arrived

    await vi.waitFor(() => expect(preload).toHaveBeenCalledTimes(1))

    refresh.answer(problem(401, 'UNAUTHENTICATED'))
    expect(await screen.findByLabelText('이메일')).toBeTruthy()
  })

  it('기기에 로그인 기록이 있으면 받지 않는다. 갱신이 로그인 필요여도 로그인 화면을 열 때 받는다', async () => {
    await seedLogin()
    const refresh = delayed()
    backend.refreshResponse = refresh.respond
    const preload = await open('/home')
    await refresh.arrived
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(preload).not.toHaveBeenCalled()

    refresh.answer(problem(401, 'UNAUTHENTICATED'))
    expect(await screen.findByLabelText('이메일')).toBeTruthy()
    expect(preload).not.toHaveBeenCalled()
  })
})
