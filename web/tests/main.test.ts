import { http, HttpResponse } from 'msw'
import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'

vi.stubGlobal('scrollTo', vi.fn())

const server = startMockServer()

/** index.html처럼 #root를 두고 앱을 시작한다. 갱신 요청을 모아 돌려준다. */
async function startApp(response: () => Response) {
  const refreshes: Request[] = []
  server.use(
    http.post('/api/v1/auth/refresh', ({ request }) => {
      refreshes.push(request)
      return response()
    }),
  )
  document.body.innerHTML = '<div id="root"></div>'
  vi.resetModules()
  await import('../src/main')
  return refreshes
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('앱 시작', () => {
  it.each([
    ['로그인한 기기', () => HttpResponse.json({ accessToken: 'token-1' })],
    ['로그인하지 않은 기기', () => problem(401, 'UNAUTHENTICATED')],
    ['서버 오류', () => problem(500, 'INTERNAL_ERROR')],
    ['연결 오류', () => HttpResponse.error()],
  ])('갱신 호출 한 번으로 로그인 상태를 되찾아 보고 화면은 막지 않는다: %s', async (_, response) => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    const refreshes = await startApp(response)
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy()
    await vi.waitFor(() => expect(refreshes).toHaveLength(1))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(refreshes).toHaveLength(1)
    expect(refreshes[0].headers.get('X-Akkimpyo-Client')).toBe('web')
    expect(unhandled).not.toHaveBeenCalled()
    process.off('unhandledRejection', unhandled)
  })
})
