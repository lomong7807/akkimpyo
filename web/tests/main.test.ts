import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startBackend, type Backend } from './support/backend'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'

vi.stubGlobal('scrollTo', vi.fn())

const server = startMockServer()

/** index.html처럼 #root를 두고 앱을 시작한다. */
async function startApp() {
  document.body.innerHTML = '<div id="root"></div>'
  vi.resetModules()
  await import('../src/main')
}

beforeEach(() => {
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  document.body.replaceChildren()
})

describe('앱 시작', () => {
  it.each<[string, (backend: Backend) => void, string]>([
    ['로그인한 기기', (backend) => (backend.cookieUser = 'user-1'), '찾을 수 없어요.'],
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

  it('개발 때의 StrictMode에서도 로그인하면 원래 주소의 화면이 열린다', async () => {
    const backend = startBackend(server)
    window.history.replaceState(null, '', '/accounts?month=2026-11')
    await startApp()
    await userEvent.type(await screen.findByLabelText('이메일'), 'name@example.com')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'pass1234')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))
    expect(await screen.findByRole('heading', { level: 1, name: '찾을 수 없어요.' })).toBeTruthy()
    expect(window.location.pathname + window.location.search).toBe('/accounts?month=2026-11')
    expect(backend.requests.refresh).toHaveLength(1)
    expect(sessionStorage.length).toBe(0)
  })
})
