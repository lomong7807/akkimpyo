import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SegmentedChoice from '../src/components/SegmentedChoice'
import { readCssRule } from './support/cssRule'
import { readWebFile } from './support/webFile'

const CSS = 'src/components/SegmentedChoice.module.css'

const expense = { value: 'EXPENSE', label: '지출' }
const income = { value: 'INCOME', label: '수입' }
const transfer = { value: 'TRANSFER', label: '이체' }
const two = [expense, income]
const three = [expense, income, transfer]

/** 앞뒤에 버튼이 있는 화면. 고른 값은 화면이 들고 있다. */
function renderChoice(options = two, initial = 'EXPENSE') {
  const onChange = vi.fn()
  function Screen() {
    const [value, setValue] = useState(initial)
    return (
      <>
        <button type="button">앞</button>
        <SegmentedChoice
          label="구분"
          options={options}
          value={value}
          onChange={(next) => {
            onChange(next)
            setValue(next)
          }}
        />
        <button type="button">뒤</button>
      </>
    )
  }
  render(<Screen />)
  return { onChange, user: userEvent.setup() }
}

const group = () => screen.getByRole('radiogroup', { name: '구분' })
const option = (name: string) => screen.getByRole('radio', { name })
const checkedNames = () => screen.getAllByRole('radio', { checked: true }).map((radio) => radio.textContent)
const focusedName = () => document.activeElement?.textContent

afterEach(cleanup)

describe('유형 고르기', () => {
  it('이름이 있는 고르기 묶음 안에 준 순서대로 칸이 있고 하나만 골라져 있다', () => {
    renderChoice(three, 'INCOME')
    expect([...group().children]).toEqual(screen.getAllByRole('radio'))
    expect(screen.getAllByRole('radio').map((radio) => [radio.textContent, radio.getAttribute('aria-checked')])).toEqual([
      ['지출', 'false'],
      ['수입', 'true'],
      ['이체', 'false'],
    ])
  })

  it('칸을 누르면 그 값을 알리고 그 칸만 골라진다', async () => {
    const { onChange, user } = renderChoice()
    await user.click(option('수입'))
    expect(onChange.mock.calls).toEqual([['INCOME']])
    expect(checkedNames()).toEqual(['수입'])
  })

  it('이미 고른 칸은 누르거나 Space, Enter를 쳐도 알리지 않는다', async () => {
    const { onChange, user } = renderChoice()
    await user.click(option('지출'))
    await user.keyboard(' {Enter}')
    expect(onChange).not.toHaveBeenCalled()
    expect(checkedNames()).toEqual(['지출'])
  })

  it('양식 안에 있어도 양식을 보내지 않는다', async () => {
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault())
    const { user } = renderChoice()
    const form = document.createElement('form')
    form.addEventListener('submit', onSubmit)
    document.body.append(form)
    form.append(group().parentElement!)
    await user.click(option('수입'))
    expect(onSubmit).not.toHaveBeenCalled()
    form.remove()
  })
})

describe('유형 고르기의 키보드', () => {
  it('Tab으로는 고른 칸 하나에만 들어가고, 한 번 더 누르면 나간다', async () => {
    const { user } = renderChoice(three, 'INCOME')
    await user.tab()
    expect(focusedName()).toBe('앞')
    await user.tab()
    expect(focusedName()).toBe('수입')
    await user.tab()
    expect(focusedName()).toBe('뒤')
    await user.tab({ shift: true })
    expect(focusedName()).toBe('수입')
  })

  it.each([
    ['오른쪽', '{ArrowRight}', ['수입', '이체', '지출']],
    ['아래', '{ArrowDown}', ['수입', '이체', '지출']],
    ['왼쪽', '{ArrowLeft}', ['이체', '수입', '지출']],
    ['위', '{ArrowUp}', ['이체', '수입', '지출']],
  ])('%s 화살표로 옮기면 초점이 옮겨지며 바로 골라지고, 끝에서는 반대쪽 끝으로 간다', async (_, key, names) => {
    const { onChange, user } = renderChoice(three)
    option('지출').focus()
    for (const name of names) {
      await user.keyboard(key)
      expect(focusedName()).toBe(name)
      expect(checkedNames()).toEqual([name])
    }
    expect(onChange).toHaveBeenCalledTimes(3)
  })

  it('화살표로 화면이 스크롤되지 않는다', () => {
    renderChoice()
    const event = createEvent.keyDown(option('지출'), { key: 'ArrowDown' })
    fireEvent(option('지출'), event)
    expect(event.defaultPrevented).toBe(true)
  })

  it.each(['altKey', 'ctrlKey', 'metaKey', 'shiftKey'])(
    '%s와 함께 누른 화살표는 브라우저의 것(뒤로 가기 등)이라 가로채지 않는다',
    (modifier) => {
      const { onChange } = renderChoice()
      const event = createEvent.keyDown(option('지출'), { key: 'ArrowLeft', [modifier]: true })
      fireEvent(option('지출'), event)
      expect(event.defaultPrevented).toBe(false)
      expect(onChange).not.toHaveBeenCalled()
    },
  )

  it.each(['a', 'Home', 'End', 'Escape', 'Tab'])('%s 키는 가로채지 않는다', (key) => {
    const { onChange } = renderChoice()
    const event = createEvent.keyDown(option('지출'), { key })
    fireEvent(option('지출'), event)
    expect(event.defaultPrevented).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('유형 고르기의 모양(components.md 4절)', () => {
  const styleOf = (element: Element) => getComputedStyle(element)

  it('상자는 높이 48px, 1px 테두리, 모서리 10px, 면 색이고 고른 칸의 바탕을 모서리를 따라 자른다', () => {
    renderChoice()
    const box = styleOf(group())
    expect(box.minHeight).toBe('var(--size-field)')
    expect(box.borderRadius).toBe('var(--radius-10)')
    expect(box.backgroundColor).toBe('var(--color-surface)')
    expect(box.overflow).toBe('hidden')
    expect(readCssRule(CSS, '.box')).toContain('border: 1px solid var(--color-border-strong)')
  })

  it.each([
    ['두', two],
    ['세', three],
  ])('%s 칸의 폭이 같다', (_, options) => {
    renderChoice(options)
    expect(styleOf(group()).display).toBe('grid')
    expect(styleOf(group()).gridAutoFlow).toBe('column')
    expect(styleOf(group()).gridAutoColumns).toBe('minmax(0, 1fr)')
  })

  it('칸 사이에만 1px 선이 있고 칸에는 모서리가 없다', () => {
    renderChoice(three)
    for (const radio of screen.getAllByRole('radio')) {
      expect(styleOf(radio).borderTopWidth.replace('medium', '0px')).toMatch(/^0(px)?$/)
      expect(styleOf(radio).borderRadius).toBe('0px')
    }
    expect(readCssRule(CSS, '.option + .option')).toContain('border-inline-start: 1px solid var(--color-border)')
  })

  it('고른 칸은 옅은 강조 바탕, 강조 글자, 굵은 본문이고 나머지는 보조 글자색, 본문이다', () => {
    renderChoice()
    expect(styleOf(option('지출')).backgroundColor).toBe('var(--color-accent-weak)')
    expect(styleOf(option('지출')).color).toBe('var(--color-accent)')
    expect(styleOf(option('지출')).font).toBe('var(--text-body-strong)')
    expect(styleOf(option('수입')).backgroundColor.replace('rgba(0, 0, 0, 0)', 'transparent')).toBe('transparent')
    expect(styleOf(option('수입')).color).toBe('var(--color-text-secondary)')
    expect(styleOf(option('수입')).font).toBe('var(--text-body)')
  })

  it('키보드 초점 테두리는 상자가 잘라 내지 않게 칸 안쪽에 그린다', () => {
    expect(readCssRule(CSS, '.option:focus-visible')).toContain('outline-offset: calc(-1 * var(--focus-ring-width))')
  })

  it('누르는 동안 100ms에 걸쳐 조금 작아진다. 마우스를 올린 모양과 비활성 모양은 없다', () => {
    expect(readCssRule(CSS, '.option:active')).toContain('transform: scale(var(--motion-press-scale))')
    renderChoice()
    expect(styleOf(option('지출')).transition).toContain('transform var(--motion-press-duration)')
    expect(readWebFile(CSS)).not.toMatch(/:hover|disabled/)
  })
})
