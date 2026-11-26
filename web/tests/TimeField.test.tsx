import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TextAreaField from '../src/components/TextAreaField'
import TimeField from '../src/components/TimeField'
import { readCssRule } from './support/cssRule'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function Time({ initial = '', readOnly = false, onChange = vi.fn() }) {
  const [value, setValue] = useState(initial)
  return (
    <TimeField
      label="시각"
      value={value}
      readOnly={readOnly}
      onChange={(next) => {
        onChange(next)
        setValue(next)
      }}
    />
  )
}

const time = () => screen.getByLabelText<HTMLInputElement>('시각')
const clearButton = () => screen.queryByRole('button', { name: '지우기' })

describe('시각 칸', () => {
  it('숫자 키패드를 쓰는 글자 칸이다', () => {
    render(<Time />)
    expect(time().type).toBe('text')
    expect(time().inputMode).toBe('numeric')
  })

  it('비면 흐린 글자 "시각 없음"이 보이고 "지우기"가 없다', () => {
    render(<Time />)
    expect(time().placeholder).toBe('시각 없음')
    expect(clearButton()).toBeNull()
  })

  it('숫자 네 자리를 치면 가운데에 쌍점이 들어간다', async () => {
    const user = userEvent.setup()
    render(<Time />)
    await user.type(time(), '1430')
    expect(time().value).toBe('14:30')
  })

  it('다섯째 숫자와 숫자가 아닌 글자는 들어가지 않는다', async () => {
    const user = userEvent.setup()
    render(<Time />)
    await user.type(time(), '1a4-305')
    expect(time().value).toBe('14:30')
  })

  it('쌍점을 직접 쳐도 된다', async () => {
    const user = userEvent.setup()
    render(<Time />)
    await user.type(time(), '9:05')
    expect(time().value).toBe('9:05')
  })

  it('지우면 쌍점 앞뒤의 숫자를 차례로 지우고 쌍점에 막히지 않는다', async () => {
    const user = userEvent.setup()
    render(<Time initial="14:30" />)
    await user.click(time())
    time().setSelectionRange(5, 5)
    await user.keyboard('{Backspace}')
    expect(time().value).toBe('14:3')
    await user.keyboard('{Backspace}')
    expect(time().value).toBe('14:')
    await user.keyboard('{Backspace}')
    expect(time().value).toBe('14')
    await user.keyboard('{Backspace}')
    expect(time().value).toBe('1')
    await user.keyboard('{Backspace}')
    expect(time().value).toBe('')
  })

  it('쌍점 바로 뒤에서 지우면 쌍점 앞의 숫자를 지운다', async () => {
    const user = userEvent.setup()
    render(<Time initial="14:30" />)
    await user.click(time())
    time().setSelectionRange(3, 3)
    await user.keyboard('{Backspace}')
    expect(time().value).toBe('13:0')
    expect(time().selectionStart).toBe(1)
  })

  it('붙여넣은 "14:30"은 그대로다', async () => {
    const user = userEvent.setup()
    render(<Time />)
    await user.click(time())
    await user.paste('14:30')
    expect(time().value).toBe('14:30')
  })

  it('값이 있으면 칸 안 오른쪽에 "지우기"가 있고, 누르면 비우고 초점이 칸에 남는다', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Time initial="14:30" onChange={onChange} />)
    expect(clearButton()).toBeTruthy()
    clearButton()!.focus()
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenLastCalledWith('')
    expect(time().value).toBe('')
    expect(clearButton()).toBeNull()
    expect(document.activeElement).toBe(time())
  })

  it('"지우기"는 칸 안 오른쪽의 글자 버튼(color-accent, 600, 누르는 높이 44px)이다', () => {
    render(<Time initial="14:30" />)
    expect(clearButton()!.className).toContain('text')
    expect(readCssRule('src/components/Button.module.css', '.text')).toContain('color: var(--color-accent)')
    expect(readCssRule('src/components/Button.module.css', '.text,\n.textDanger')).toContain(
      'min-height: var(--size-touch)',
    )
    expect(clearButton()!.closest('[class*="action"]')).toBeTruthy()
  })

  it('바꿀 수 없을 때는 글자도 "지우기"도 값을 바꾸지 않는다', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Time initial="14:30" readOnly onChange={onChange} />)
    await user.type(time(), '1')
    await user.click(clearButton()!)
    expect(time().value).toBe('14:30')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('오류 문구를 칸 아래에 잇는다', () => {
    render(<TimeField label="시각" value="24:00" onChange={vi.fn()} error="시각은 00:00부터 23:59까지 입력할 수 있어요" />)
    expect(time().getAttribute('aria-invalid')).toBe('true')
    const described = time().getAttribute('aria-describedby')!
    expect(document.getElementById(described)!.textContent).toBe('시각은 00:00부터 23:59까지 입력할 수 있어요')
  })
})

function Memo({ initial = '' }) {
  const [value, setValue] = useState(initial)
  return (
    <TextAreaField
      label="메모"
      value={value}
      count={{ current: [...value].length, max: 500 }}
      onChange={(event) => setValue(event.target.value)}
    />
  )
}

const memo = () => screen.getByLabelText<HTMLTextAreaElement>('메모')

describe('여러 줄 칸', () => {
  it('이름과 묶인 textarea이고 엔터는 줄바꿈이다', async () => {
    const user = userEvent.setup()
    render(<Memo />)
    expect(memo().tagName).toBe('TEXTAREA')
    await user.type(memo(), '첫 줄{Enter}둘째 줄')
    expect(memo().value).toBe('첫 줄\n둘째 줄')
  })

  it('세 줄(72px과 위아래 12px)로 시작해 여덟 줄까지 커지고 그 뒤 안에서 스크롤한다', () => {
    const rule = readCssRule('src/components/TextAreaField.module.css', '.area')
    expect(rule).toContain('min-height: calc(3 * var(--space-24) + 2 * (var(--space-12) + 1px))')
    expect(rule).toContain('max-height: calc(8 * var(--space-24) + 2 * (var(--space-12) + 1px))')
    expect(rule).toContain('height: var(--content-height, auto)')
    expect(rule).toContain('overflow-y: auto')
    expect(rule).toContain('resize: none')
  })

  it('쓸 때마다 글의 높이를 재어 넘긴다', async () => {
    vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLTextAreaElement) {
      return 24 * this.value.split('\n').length + 24
    })
    const user = userEvent.setup()
    render(<Memo />)
    await user.type(memo(), '1{Enter}2{Enter}3{Enter}4')
    expect(memo().style.getPropertyValue('--content-height')).toBe(`${24 * 4 + 24}px`)
  })

  it('입력칸과 같은 모양이다', () => {
    render(<Memo />)
    expect(memo().className).toContain('control')
  })

  it('400자를 넘으면 글자 수가 보인다', () => {
    render(<Memo initial={'가'.repeat(401)} />)
    expect(screen.getByText('401/500')).toBeTruthy()
  })

  it('400자까지는 글자 수가 없다', () => {
    render(<Memo initial={'가'.repeat(400)} />)
    expect(screen.queryByText(/\/500$/)).toBeNull()
  })
})
