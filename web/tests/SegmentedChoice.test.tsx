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

describe('읽기 전용', () => {
  function renderReadOnly(readOnly: boolean) {
    const onChange = vi.fn()
    render(<SegmentedChoice label="구분" options={three} value="INCOME" onChange={onChange} readOnly={readOnly} />)
    return { onChange, user: userEvent.setup() }
  }

  it('눌러도 화살표를 쳐도 바뀌지 않고 초점도 옮기지 않으며, 바꿀 수 없음을 알린다', async () => {
    const { onChange, user } = renderReadOnly(true)
    expect(group().getAttribute('aria-readonly')).toBe('true')
    await user.click(option('이체'))
    option('수입').focus()
    await user.keyboard('{ArrowRight} {Enter}')
    expect(onChange).not.toHaveBeenCalled()
    expect(focusedName()).toBe('수입')
  })

  it('모양은 그대로다', () => {
    const looks = [true, false].map((readOnly) => {
      renderReadOnly(readOnly)
      const look = [group(), ...screen.getAllByRole('radio')].map((element) => {
        const { backgroundColor, color, font, cursor, opacity } = getComputedStyle(element)
        return { backgroundColor, color, font, cursor, opacity }
      })
      cleanup()
      return look
    })
    expect(looks[0]).toEqual(looks[1])
  })

  it('읽기 전용이 아니면 aria-readonly가 없다', () => {
    renderReadOnly(false)
    expect(group().hasAttribute('aria-readonly')).toBe(false)
  })
})

describe('양식 안의 유형 고르기', () => {
  it('ref는 고른 칸이고 고른 칸이 바뀌면 따라간다', () => {
    const ref = { current: null as HTMLButtonElement | null }
    const choice = (value: string) => (
      <SegmentedChoice label="구분" options={two} value={value} onChange={() => {}} ref={ref} />
    )
    const { rerender } = render(choice('EXPENSE'))
    expect(ref.current).toBe(option('지출'))
    rerender(choice('INCOME'))
    expect(ref.current).toBe(option('수입'))
  })

  it('설명을 잇는다', () => {
    render(
      <>
        <p id="reason">오류 문구</p>
        <SegmentedChoice label="구분" options={two} value="INCOME" onChange={() => {}} aria-describedby="reason" />
      </>,
    )
    expect(group().getAttribute('aria-describedby')).toBe('reason')
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

  it('칸에 키보드 초점이 있으면 상자 바깥에 다른 컴포넌트와 같은 초점 테두리를 그린다', () => {
    const ring = readCssRule(CSS, '.box:has(:focus-visible)')
    expect(ring).toContain('outline: var(--focus-ring-width) solid var(--color-accent)')
    expect(ring).toContain('outline-offset: var(--focus-ring-offset)')
  })

  it('칸 자신의 초점 테두리는 투명하다. 지우지는 않아 고대비 모드에서 남는다', () => {
    const own = readCssRule(CSS, '.option:focus-visible')
    expect(own).toContain('outline-color: transparent')
    expect(own).not.toContain('outline-offset')
  })

  it('고르지 않은 칸은 누르는 동안과 마우스를 올린 동안 color-press 바탕이다. 손가락으로 누른 뒤에는 남지 않는다', () => {
    expect(readCssRule(CSS, ".option[aria-checked='false']:active")).toContain('background-color: var(--color-press)')
    expect(readWebFile(CSS)).toMatch(
      /@media \(hover: hover\) \{\s*\.option\[aria-checked='false'\]:hover \{\s*background-color: var\(--color-press\);\s*\}\s*\}/,
    )
  })

  it('고른 칸은 누르거나 마우스를 올려도 그대로이고, 칸은 작아지지 않는다. 비활성 모양은 없다', () => {
    const css = readWebFile(CSS)
    expect(css.match(/:(active|hover)/g)).toHaveLength(2)
    expect(css).not.toMatch(/transform|transition|disabled/)
  })
})
