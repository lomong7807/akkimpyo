import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { routes } from '../src/app/routes'
import { renderRoutes } from './support/renderRoutes'
import { resetViewport, setViewportWidth } from './support/viewport'

vi.stubGlobal('scrollTo', vi.fn())

afterEach(() => {
  cleanup()
  resetViewport()
})

describe('찾을 수 없음(N-01)', () => {
  it.each(['/', '/home', '/없는-주소', '/transactions/1/2/3', '/home?month=2026-11'])(
    '화면이 없는 주소 %s에서 안내 문장과 홈으로 가는 길을 보여 준다',
    (path) => {
      renderRoutes(routes, path)
      const main = within(screen.getByRole('main'))
      expect(main.getByRole('heading', { level: 1, name: '찾을 수 없어요.' })).toBeTruthy()
      expect(main.getByText('주소가 바뀌었거나 지워진 항목일 수 있어요.')).toBeTruthy()
      expect(main.getByRole('link', { name: '홈으로' }).getAttribute('href')).toBe('/home')
    },
  )

  it('"홈으로"를 누르면 /home으로 간다', async () => {
    const router = renderRoutes(routes, '/없는-주소')
    fireEvent.click(screen.getByRole('link', { name: '홈으로' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/home'))
  })

  it.each([390, 768, 1280])('폭 %dpx에서 공통 틀 안에 그려 주 메뉴가 함께 보인다', (width) => {
    renderRoutes(routes, '/없는-주소')
    setViewportWidth(width)
    expect(screen.getByRole('navigation', { name: '주 메뉴' })).toBeTruthy()
  })

  it('상단 바는 기본 형태라 "뒤로"가 없다', () => {
    renderRoutes(routes, '/없는-주소')
    expect(screen.getByRole('banner')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '뒤로' })).toBeNull()
  })

  it('안내 문장의 글자는 토큰을 쓴다', () => {
    renderRoutes(routes, '/없는-주소')
    const description = getComputedStyle(screen.getByText('주소가 바뀌었거나 지워진 항목일 수 있어요.'))
    expect(description.font).toBe('var(--text-secondary)')
    expect(description.color).toBe('var(--color-text-secondary)')
  })
})
