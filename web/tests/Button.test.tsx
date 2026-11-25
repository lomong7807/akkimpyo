import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button, ButtonLink } from '../src/components/Button'
import { readCssRule } from './support/cssRule'
import { readWebFile } from './support/webFile'

const labelKinds = ['primary', 'secondary', 'text', 'text-danger', 'danger'] as const

/** 다섯 종류를 같은 이름 "저장"으로 그린다. */
const buttons: Record<string, (state: object) => ReactElement> = {
  ...Object.fromEntries(
    labelKinds.map((kind) => [
      kind,
      (state: object) => (
        <Button kind={kind} {...state}>
          저장
        </Button>
      ),
    ]),
  ),
  icon: (state: object) => <Button kind="icon" icon="X" aria-label="저장" {...state} />,
}
const kinds = Object.keys(buttons)

function renderButton(kind: string, state: object = {}) {
  render(buttons[kind](state))
  return screen.getByRole('button', { name: '저장' })
}

const ruleBody = (selector: string) => readCssRule('src/components/Button.module.css', selector)

afterEach(cleanup)

describe('모양', () => {
  it.each([
    ['primary', 'var(--color-accent)', 'var(--color-on-accent)', 'var(--size-button)'],
    ['danger', 'var(--color-danger)', 'var(--color-on-danger)', 'var(--size-button)'],
    ['secondary', 'var(--color-surface)', 'var(--color-text)', 'var(--size-button-secondary)'],
    ['text', 'transparent', 'var(--color-accent)', 'var(--size-touch)'],
    ['text-danger', 'transparent', 'var(--color-danger)', 'var(--size-touch)'],
    ['icon', 'transparent', 'var(--color-text)', 'var(--size-touch)'],
  ])('%s의 바탕, 글자색, 높이는 설계서 5.1의 토큰이다', (kind, background, color, height) => {
    const style = getComputedStyle(renderButton(kind))
    expect(style.backgroundColor.replace('rgba(0, 0, 0, 0)', 'transparent')).toBe(background)
    expect(style.color).toBe(color)
    expect(style.minHeight).toBe(height)
  })

  it.each(kinds)('%s는 모서리 10px이고 누르는 영역 폭이 44px 이상이다', (kind) => {
    const style = getComputedStyle(renderButton(kind))
    expect(style.borderRadius).toBe('var(--radius-10)')
    expect(style.minWidth).toBe('var(--size-touch)')
  })

  it.each(labelKinds)('%s의 글자는 text-body-strong 한 줄이다', (kind) => {
    const style = getComputedStyle(renderButton(kind))
    expect(style.font).toBe('var(--text-body-strong)')
    expect(style.whiteSpace).toBe('nowrap')
  })

  it('보조 버튼만 1px color-border-strong 테두리가 있다', () => {
    expect(ruleBody('.secondary')).toContain('border: 1px solid var(--color-border-strong)')
    expect(ruleBody('.button')).toContain('border: 0')
  })

  it('아이콘 버튼은 24px 아이콘을 그리고 이름은 aria-label로 읽힌다', () => {
    const icon = renderButton('icon').querySelector('svg')!
    expect(getComputedStyle(icon).width).toBe('var(--size-icon-24)')
    expect(icon.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('누르기', () => {
  it.each(kinds)('%s를 누르면 동작한다', (kind) => {
    const onClick = vi.fn()
    fireEvent.click(renderButton(kind, { onClick }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('따로 정하지 않으면 양식을 보내지 않는 버튼이다', () => {
    expect(renderButton('primary').getAttribute('type')).toBe('button')
  })

  it('누르는 동안 100ms에 0.98배로 줄고, 비활성이면 줄지 않는다', () => {
    expect(ruleBody('.button')).toContain('transition: transform var(--motion-press-duration)')
    // 움직임 줄이기에서는 --motion-press-scale이 1이다(tests/tokens.test.ts).
    expect(ruleBody(".button:active:not([aria-disabled='true'])")).toContain(
      'transform: scale(var(--motion-press-scale))',
    )
  })

  it('키보드 초점 테두리를 지우지 않는다(base.css의 :focus-visible)', () => {
    expect(readWebFile('src/components/Button.module.css')).not.toContain('outline')
  })
})

describe.each(kinds)('비활성: %s', (kind) => {
  it('aria-disabled를 달고 초점은 받을 수 있으며 눌러도 동작하지 않는다', () => {
    const onClick = vi.fn()
    const button = renderButton(kind, { disabled: true, onClick })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.hasAttribute('disabled')).toBe(false)
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('글자는 color-text-secondary이고 바탕이 있는 버튼은 color-border 바탕이다', () => {
    const style = getComputedStyle(renderButton(kind, { disabled: true }))
    const filled = ['primary', 'secondary', 'danger'].includes(kind)
    expect(style.color).toBe('var(--color-text-secondary)')
    expect(style.backgroundColor.replace('rgba(0, 0, 0, 0)', 'transparent')).toBe(
      filled ? 'var(--color-border)' : 'transparent',
    )
  })
})

describe.each(kinds)('처리 중: %s', (kind) => {
  it('aria-busy와 aria-disabled를 달고 눌러도 동작하지 않는다', () => {
    const onClick = vi.fn()
    const button = renderButton(kind, { busy: true, onClick })
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('글자는 자리를 그대로 차지한 채 보이지 않고, 그 자리에 20px 원이 돈다', () => {
    const button = renderButton(kind, { busy: true })
    const [content, spinner] = button.children
    expect(getComputedStyle(content).opacity).toBe('0')
    expect(getComputedStyle(content).display).not.toBe('none')
    const circle = getComputedStyle(spinner)
    expect(circle.width).toBe('var(--size-icon-20)')
    expect(circle.height).toBe('var(--size-icon-20)')
    expect(circle.position).toBe('absolute')
    expect(spinner.getAttribute('aria-hidden')).toBe('true')
  })

  it('원은 한 바퀴 800ms로 일정하게 계속 돌고, 움직임 줄이기에서도 돈다', () => {
    const spinner = renderButton(kind, { busy: true }).children[1]
    expect(ruleBody('.spinner')).toMatch(/animation: \w+ var\(--motion-spinner-duration\) linear infinite;/)
    // base.css의 움직임 줄이기 규칙에서 빠지는 표시(tests/base-styles.test.ts)
    expect(spinner.classList.contains('status-motion')).toBe(true)
  })

  it('처리가 끝나면 원래대로 돌아온다', () => {
    const { rerender } = render(buttons[kind]({ busy: true }))
    rerender(buttons[kind]({ busy: false }))
    const button = screen.getByRole('button', { name: '저장' })
    expect(button.hasAttribute('aria-busy')).toBe(false)
    expect(button.hasAttribute('aria-disabled')).toBe(false)
    expect(getComputedStyle(button.children[0]).opacity).toBe('1')
    expect(button.children).toHaveLength(1)
  })
})

describe('양식', () => {
  it.each([{ disabled: true }, { busy: true }])('%o인 보내기 버튼은 양식을 보내지 않는다', (state) => {
    const onSubmit = vi.fn((event) => event.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <Button kind="primary" type="submit" {...state}>
          저장
        </Button>
      </form>,
    )
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('보내기 버튼을 누르면 양식을 보낸다', () => {
    const onSubmit = vi.fn((event) => event.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <Button kind="primary" type="submit">
          저장
        </Button>
      </form>,
    )
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(onSubmit).toHaveBeenCalledOnce()
  })
})

describe('이동하는 버튼', () => {
  it('버튼 모양의 링크(a)로 그린다', () => {
    render(
      <MemoryRouter>
        <ButtonLink kind="primary" to="/home">
          홈으로
        </ButtonLink>
        <ButtonLink kind="icon" icon="Plus" aria-label="추가" to="/new" />
      </MemoryRouter>,
    )
    const home = screen.getByRole('link', { name: '홈으로' })
    expect(home.getAttribute('href')).toBe('/home')
    expect(getComputedStyle(home).backgroundColor).toBe('var(--color-accent)')
    expect(getComputedStyle(home).textDecoration).toContain('none')
    expect(screen.getByRole('link', { name: '추가' }).getAttribute('href')).toBe('/new')
  })
})
