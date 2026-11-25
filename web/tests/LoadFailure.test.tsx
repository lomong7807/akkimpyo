import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button } from '../src/components/Button'
import LoadFailure from '../src/components/LoadFailure'

const retryButton = () => screen.getByRole('button', { name: '다시 시도' })

afterEach(cleanup)

describe('불러오지 못함(F-907)', () => {
  it('안내와 글자 버튼 "다시 시도"를 보인다', () => {
    render(<LoadFailure onRetry={() => {}} />)
    expect(screen.getByRole('heading', { level: 1, name: '불러오지 못했어요.' })).toBeTruthy()
    expect(screen.getByText('잠시 후 다시 시도해 주세요.')).toBeTruthy()
    expect(getComputedStyle(retryButton()).color).toBe('var(--color-accent)')
    expect(getComputedStyle(retryButton()).minHeight).toBe('var(--size-touch)')
  })

  it('화면 이름(h1)이 따로 있는 화면에서는 제목이 2단계이고 모양은 같다', () => {
    render(<LoadFailure onRetry={() => {}} />)
    const { font, margin } = getComputedStyle(screen.getByRole('heading'))
    cleanup()
    render(<LoadFailure headingLevel={2} onRetry={() => {}} />)
    const heading = screen.getByRole('heading', { level: 2, name: '불러오지 못했어요.' })
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    expect(font).toBe('var(--text-title)')
    expect(getComputedStyle(heading).font).toBe(font)
    expect(getComputedStyle(heading).margin).toBe(margin)
  })

  it('"다시 시도"를 누르면 알린다', async () => {
    const onRetry = vi.fn()
    render(<LoadFailure onRetry={onRetry} />)
    await userEvent.click(retryButton())
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('다시 시도하는 동안 안내는 그대로이고 그 버튼만 처리 중이라 다시 눌리지 않는다', async () => {
    const onRetry = vi.fn()
    render(<LoadFailure onRetry={onRetry} busy />)
    expect(screen.getByText('잠시 후 다시 시도해 주세요.')).toBeTruthy()
    expect(retryButton().getAttribute('aria-busy')).toBe('true')
    await userEvent.click(retryButton())
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('다른 동작은 "다시 시도" 아래에 8px 떨어져 가운데로 놓인다', () => {
    render(
      <LoadFailure onRetry={() => {}}>
        <Button kind="text">다른 동작</Button>
      </LoadFailure>,
    )
    const names = screen.getAllByRole('button').map((button) => button.textContent)
    expect(names).toEqual(['다시 시도', '다른 동작'])
    const actions = getComputedStyle(retryButton().parentElement!)
    expect(actions.flexDirection).toBe('column')
    expect(actions.alignItems).toBe('center')
    expect(actions.gap).toBe('var(--space-8)')
  })
})
