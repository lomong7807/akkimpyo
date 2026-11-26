import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import StatusChip from '../src/components/StatusChip'
import { readCssRule } from './support/cssRule'

afterEach(cleanup)

describe('표시 칩(00-common 5.11)', () => {
  it('높이 24px, 좌우 8px, 완전히 둥글고 옅은 바탕에 작은 보조 글자다', () => {
    render(<StatusChip>기본</StatusChip>)
    const chip = getComputedStyle(screen.getByText('기본'))
    expect(chip.height).toBe('var(--size-chip)')
    expect(chip.getPropertyValue('padding-inline')).toBe('var(--space-8)')
    expect(chip.font).toBe('var(--text-caption)')
    expect(chip.borderRadius).toBe('var(--radius-full)')
    expect(chip.backgroundColor).toBe('var(--color-border)')
    expect(chip.color).toBe('var(--color-text-secondary)')
  })

  it('글자는 한 줄이고 줄 안에서 줄어들지 않는다', () => {
    render(<StatusChip>기본</StatusChip>)
    const chip = getComputedStyle(screen.getByText('기본'))
    expect(chip.whiteSpace).toBe('nowrap')
    expect(chip.flex).toBe('0 0 auto')
  })

  it('누르는 것이 아니다', () => {
    render(<StatusChip>기본</StatusChip>)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('기본').tabIndex).toBe(-1)
  })
})

describe('길 수 있는 이름의 표시 칩(wrap)', () => {
  const long = '가나다라마바사아자차카타파하거너더러머'

  it('놓인 칸보다 길면 줄을 바꾸고 높이는 24px부터 늘어난다', () => {
    render(<StatusChip wrap>{long}</StatusChip>)
    const chip = getComputedStyle(screen.getByText(long))
    expect(chip.whiteSpace).toBe('normal')
    expect(chip.getPropertyValue('overflow-wrap')).toBe('anywhere')
    expect(chip.maxWidth).toBe('100%')
    expect(chip.height).toBe('auto')
    expect(chip.minHeight).toBe('var(--size-chip)')
  })

  it('줄이 늘어도 글자 위아래 여백은 한 줄일 때와 같다', () => {
    expect(readCssRule('src/components/StatusChip.module.css', '.wrap')).toContain(
      'padding-block: max(0px, (var(--size-chip) - 1lh) / 2);',
    )
  })

  it('모서리, 좌우 여백, 바탕, 글자는 보통 칩과 같다', () => {
    render(<StatusChip wrap>{long}</StatusChip>)
    const chip = getComputedStyle(screen.getByText(long))
    expect(chip.borderRadius).toBe('var(--radius-full)')
    expect(chip.getPropertyValue('padding-inline')).toBe('var(--space-8)')
    expect(chip.backgroundColor).toBe('var(--color-border)')
    expect(chip.color).toBe('var(--color-text-secondary)')
    expect(chip.font).toBe('var(--text-caption)')
  })

  it('주지 않으면 한 줄이다', () => {
    render(<StatusChip>기본</StatusChip>)
    expect(getComputedStyle(screen.getByText('기본')).whiteSpace).toBe('nowrap')
  })
})
