import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AuthLink from '../src/features/auth/AuthLink'
import RetryMessage from '../src/components/RetryMessage'
import { renderRoutes } from './support/renderRoutes'

afterEach(cleanup)

describe('로그인과 가입이 서로에게 가는 줄', () => {
  function open() {
    const row = (
      <AuthLink question="계정이 없나요?" to="/signup" email="name@example.com">
        가입
      </AuthLink>
    )
    return renderRoutes([{ path: '/login', element: row }, { path: '/signup', element: null }], '/login')
  }

  it('묻는 말과 링크를 한 문장으로 읽는다', () => {
    open()
    expect(screen.getByRole('link', { name: '가입' }).closest('p')!.textContent).toBe('계정이 없나요? 가입')
  })

  it('글자를 키워 두 줄이 되면 링크의 글자가 묻는 말과 같은 왼쪽 선에서 시작한다', () => {
    open()
    const link = screen.getByRole('link', { name: '가입' })
    const row = getComputedStyle(link.closest('p')!)
    expect(row.display).toBe('flex')
    expect(row.flexWrap).toBe('wrap')
    expect(row.columnGap).toBe('var(--space-12)')
    // 링크의 안쪽 여백만큼 당긴다
    expect(getComputedStyle(link.parentElement!).getPropertyValue('margin-inline-start')).toBe(
      'calc(-1 * var(--space-8))',
    )
    expect(getComputedStyle(link).paddingInline).toBe('var(--space-8)')
  })

  it('이메일만 주소에 담지 않고 넘긴다', async () => {
    const router = open()
    await userEvent.click(screen.getByRole('link', { name: '가입' }))
    expect(router.state.location).toMatchObject({ pathname: '/signup', search: '', hash: '' })
    expect(router.state.location.state).toEqual({ email: 'name@example.com' })
  })
})

describe('보내지 못했다는 문구와 "다시 시도"', () => {
  it('"다시 시도"의 초점 테두리가 문구와 겹치지 않게 4px 띄운다', () => {
    renderRoutes([{ path: '/', element: <RetryMessage onRetry={vi.fn()}>보내지 못했어요.</RetryMessage> }], '/')
    const message = getComputedStyle(screen.getByRole('alert').parentElement!)
    expect(message.display).toBe('flex')
    expect(message.flexDirection).toBe('column')
    expect(message.gap).toBe('var(--space-4)')
  })
})
