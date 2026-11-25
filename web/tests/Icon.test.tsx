import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import Icon, { type IconName } from '../src/components/Icon'
import { readWebFile } from './support/webFile'

const files: Record<IconName, string> = {
  CaretLeft: 'caret-left',
  CaretRight: 'caret-right',
  Check: 'check',
  DotsThree: 'dots-three',
  Eye: 'eye',
  EyeSlash: 'eye-slash',
  Info: 'info',
  Plus: 'plus',
  SignOut: 'sign-out',
  Wallet: 'wallet',
  WarningCircle: 'warning-circle',
  X: 'x',
}
const names = Object.keys(files) as IconName[]

function phosphorFile(name: IconName): Element {
  const svg = readWebFile(`src/assets/icons/phosphor/${files[name]}.svg`)
  return new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement
}

function paths(svg: Element): (string | null)[] {
  return [...svg.querySelectorAll('path')].map((path) => path.getAttribute('d'))
}

afterEach(cleanup)

describe('Icon', () => {
  it.each(names)('%s는 레포에 둔 Phosphor Regular SVG와 같은 모양을 그린다', (name) => {
    render(<Icon name={name} size={24} label={name} />)
    const icon = screen.getByRole('img', { name })
    expect(paths(icon).length).toBeGreaterThan(0)
    expect(paths(icon)).toEqual(paths(phosphorFile(name)))
    expect(icon.getAttribute('viewBox')).toBe(phosphorFile(name).getAttribute('viewBox'))
  })

  it('색은 둘레 글자의 색을 따른다', () => {
    render(<Icon name="WarningCircle" size={20} label="오류" />)
    expect(screen.getByRole('img', { name: '오류' }).getAttribute('fill')).toBe('currentColor')
  })

  it.each([20, 24] as const)('크기 %d은 그 크기의 토큰으로 그린다', (size) => {
    render(<Icon name="Plus" size={size} label="더하기" />)
    const style = getComputedStyle(screen.getByRole('img', { name: '더하기' }))
    expect(style.width).toBe(`var(--size-icon-${size})`)
    expect(style.height).toBe(`var(--size-icon-${size})`)
  })

  it('이름을 주지 않으면 장식이라 화면 낭독기가 읽지 않고, 버튼 이름만 읽힌다', () => {
    render(
      <button type="button" aria-label="닫기">
        <Icon name="X" size={24} />
      </button>,
    )
    const button = screen.getByRole('button', { name: '닫기' })
    expect(screen.queryByRole('img')).toBeNull()
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('아이콘 라이선스(MIT) 표기가 있다', () => {
    const license = readWebFile('src/assets/icons/phosphor/LICENSE')
    expect(license).toContain('MIT License')
    expect(license).toContain('Phosphor Icons')
  })
})
