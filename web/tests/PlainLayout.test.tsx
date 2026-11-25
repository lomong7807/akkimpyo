import { cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import PlainLayout from '../src/app/PlainLayout'
import { renderRoutes } from './support/renderRoutes'
import { resetViewport, setViewportWidth } from './support/viewport'

const routes = [{ element: <PlainLayout />, children: [{ path: '/login', element: <p>내용</p> }] }]

afterEach(() => {
  cleanup()
  resetViewport()
})

describe('틀이 없는 화면의 틀(로그인, 첫 실행 안내)', () => {
  it.each([390, 768, 1280])('폭 %dpx에서 주 메뉴와 상단 바 없이 내용만 그린다', (width) => {
    renderRoutes(routes, '/login')
    setViewportWidth(width)
    expect(screen.getByRole('main').textContent).toBe('내용')
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.queryByRole('banner')).toBeNull()
  })

  it('내용 아래 여백 24px에 위아래 안전 영역을 더한다', () => {
    renderRoutes(routes, '/login')
    expect(getComputedStyle(screen.getByRole('main')).getPropertyValue('padding-block')).toBe(
      'env(safe-area-inset-top) calc(var(--space-24) + env(safe-area-inset-bottom))',
    )
  })

  it.each([
    [390, '100%', 'var(--space-16)'],
    [768, 'var(--width-content-narrow)', 'var(--space-16)'],
    [1024, 'var(--width-content-wide)', 'var(--space-24)'],
  ])('폭 %dpx에서 내용 폭은 %s, 좌우 여백은 %s이다', (width, contentWidth, gutter) => {
    renderRoutes(routes, '/login')
    setViewportWidth(width)
    const main = getComputedStyle(screen.getByRole('main'))
    expect(main.getPropertyValue('--content-width')).toBe(contentWidth)
    expect(main.getPropertyValue('--gutter')).toBe(gutter)
  })
})
