import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import Notice from '../src/components/Notice'

const text = '로그인이 풀렸어요. 다시 로그인해 주세요.'
const notice = () => screen.getByRole('status')
const styleOf = (element: Element) => getComputedStyle(element)

afterEach(cleanup)

describe('알림 띠', () => {
  it('글과 정보 아이콘을 보이고 화면 낭독기에 알린다. 닫기 버튼은 없다', () => {
    render(<Notice>{text}</Notice>)
    expect(notice().textContent).toBe(text)
    expect(notice().querySelectorAll('svg')).toHaveLength(1)
    expect(notice().querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('연결 없음 띠와 같은 바탕에 본문 글자색이고 모서리는 12px이다', () => {
    render(<Notice>{text}</Notice>)
    expect(styleOf(notice()).backgroundColor).toBe('var(--color-border)')
    expect(styleOf(notice()).color).toBe('var(--color-text)')
    expect(styleOf(notice()).font).toBe('var(--text-secondary)')
    expect(styleOf(notice()).borderRadius).toBe('var(--radius-12)')
  })

  it('안쪽 여백은 위아래 12px, 좌우 16px이고 아이콘과 글 사이는 8px이다', () => {
    render(<Notice>{text}</Notice>)
    expect(styleOf(notice()).getPropertyValue('padding-block')).toBe('var(--space-12)')
    expect(styleOf(notice()).getPropertyValue('padding-inline')).toBe('var(--space-16)')
    expect(styleOf(notice()).gap).toBe('var(--space-8)')
    expect(styleOf(notice().querySelector('svg')!).width).toBe('var(--size-icon-20)')
  })

  it('글이 두 줄이면 아이콘을 첫 줄에 맞춘다', () => {
    render(<Notice>{text}</Notice>)
    expect(styleOf(notice()).alignItems).toBe('flex-start')
  })
})
