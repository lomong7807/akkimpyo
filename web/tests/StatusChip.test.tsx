import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import StatusChip from '../src/components/StatusChip'

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
