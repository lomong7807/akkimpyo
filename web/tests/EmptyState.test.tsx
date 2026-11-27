import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import EmptyState from '../src/components/EmptyState'

const text = '거래가 없어요. 거래를 입력하면 여기에 보여요.'

afterEach(cleanup)

describe('데이터 없음(00-common 4.2)', () => {
  it('설명만 있고 제목, 그림, 버튼이 없다', () => {
    const { container } = render(<EmptyState description={text} />)
    expect(container.textContent).toBe(text)
    expect(screen.getByText(text).tagName).toBe('P')
    expect(container.querySelector('h1, h2, h3, svg, img, button, a')).toBeNull()
  })

  it('놓인 자리 맨 위에서 40px 아래에 가운데 정렬이고 본문 크기의 보조 글자색이다', () => {
    const { container } = render(<EmptyState description={text} />)
    const area = getComputedStyle(container.firstElementChild!)
    expect(area.paddingTop).toBe('var(--space-40)')
    expect(area.textAlign).toBe('center')
    const style = getComputedStyle(screen.getByText(text))
    expect(style.font).toBe('var(--text-body)')
    expect(style.color).toBe('var(--color-text-secondary)')
    expect(style.margin).toBe('0px')
  })

  it('버튼은 설명 아래 16px에 글자에 맞춘 폭으로 둔다', () => {
    render(
      <EmptyState description={text}>
        <button type="button">거래 입력</button>
      </EmptyState>,
    )
    const button = screen.getByRole('button', { name: '거래 입력' })
    expect(button.parentElement!.previousElementSibling).toBe(screen.getByText(text))
    expect(getComputedStyle(button.parentElement!).marginTop).toBe('var(--space-16)')
    expect(getComputedStyle(button.parentElement!).display).toBe('block')
  })

  it('남는 자리를 채우지 않아 아래에 목록이 이어질 수 있다', () => {
    const { container } = render(<EmptyState description={text} />)
    const area = getComputedStyle(container.firstElementChild!)
    expect(area.flexGrow).toBe('0')
    expect(area.minHeight).toBe('auto')
    expect(area.height).toBe('auto')
  })
})
