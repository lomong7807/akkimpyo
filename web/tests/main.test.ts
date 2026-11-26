import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse } from 'msw'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startBackend, type Backend } from './support/backend'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'

vi.stubGlobal('scrollTo', vi.fn())

/**
 * 앱이 만든 React 루트. 앱은 src/main이 createRoot로 그리므로 testing-library의 cleanup이 내리지 않는다. 내리지 않으면
 * 앞 테스트의 앱이 다음 테스트와 파일이 끝난 뒤에도 돌아, 늦게 온 응답의 알림이 jsdom을 정리한 뒤에 화면을 고치려다
 * 오류가 난다(#260 확인 중, 전체 실행 50번 중 3번 'window is not defined').
 */
const roots = vi.hoisted(() => [] as Root[])
vi.mock(import('react-dom/client'), async (importOriginal) => {
  const client = await importOriginal()
  return {
    ...client,
    createRoot: (...args: Parameters<typeof client.createRoot>) => {
      const root = client.createRoot(...args)
      roots.push(root)
      return root
    },
  }
})

const server = startMockServer()

/** index.html처럼 #root를 두고 앱을 시작한다. */
async function startApp() {
  document.body.innerHTML = '<div id="root"></div>'
  vi.resetModules()
  await import('../src/main')
}

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  localStorage.clear()
})

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()))
  document.body.replaceChildren()
})

describe('앱 시작', () => {
  it.each<[string, (backend: Backend) => void, string]>([
    ['로그인한 기기', (backend) => (backend.cookieUser = 'user-1'), '홈'],
    ['로그인하지 않은 기기', () => {}, '로그인'],
    ['서버 오류', (backend) => (backend.refreshResponse = () => problem(500, 'INTERNAL_ERROR')), '불러오지 못했어요.'],
    ['연결 오류', (backend) => (backend.refreshResponse = () => HttpResponse.error()), '불러오지 못했어요.'],
  ])('갱신 호출 한 번으로 로그인 상태를 확인한다: %s', async (_, prepare, heading) => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    const backend = startBackend(server)
    prepare(backend)
    await startApp()
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeTruthy()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(backend.requests.refresh).toHaveLength(1)
    expect(backend.requests.refresh[0].headers.get('X-Akkimpyo-Client')).toBe('web')
    expect(unhandled).not.toHaveBeenCalled()
    process.off('unhandledRejection', unhandled)
  })

  it('서버에 닿지 못한 로그아웃이 있으면 갱신하지 않고 로그아웃을 한 번만 다시 보낸다', async () => {
    const { recordLogout } = await import('../src/api/sessionMarks')
    recordLogout()
    const backend = startBackend(server)
    backend.cookieUser = 'user-1'
    backend.logoutResponse = () => HttpResponse.error()
    await startApp()
    expect(await screen.findByRole('heading', { level: 1, name: '로그인' })).toBeTruthy()
    // 다시 보내는 로그아웃은 표시를 읽기까지 잠깐 기다린다
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(backend.requests.logout).toHaveLength(1)
    expect(backend.requests.refresh).toHaveLength(0)
  })

  it('개발 때의 StrictMode에서도 로그인하면 원래 주소의 화면이 열린다', async () => {
    const backend = startBackend(server)
    window.history.replaceState(null, '', '/no-such-screen?month=2026-11')
    await startApp()
    await userEvent.type(await screen.findByLabelText('이메일'), 'name@example.com')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'pass1234')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))
    expect(await screen.findByRole('heading', { level: 1, name: '찾을 수 없어요.' })).toBeTruthy()
    expect(window.location.pathname + window.location.search).toBe('/no-such-screen?month=2026-11')
    expect(backend.requests.refresh).toHaveLength(1)
    expect(sessionStorage.length).toBe(0)
  })
})
