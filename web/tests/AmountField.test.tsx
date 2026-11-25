import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AmountField from '../src/components/AmountField'
import { readCssRule } from './support/cssRule'

const CSS = 'src/components/AmountField.module.css'
const tooLarge = '9,999,999,999원까지 입력할 수 있어요.'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

interface Options {
  initial?: number
  /** 부호 버튼을 둔다 */
  signed?: boolean
  negative?: boolean
  error?: string
  readOnly?: boolean
}

/** 값을 들고 있는 화면. 앞뒤에 칸이 하나씩 있다. */
function renderField({ initial, signed = false, negative: initialNegative = false, error, readOnly }: Options = {}) {
  const onChange = vi.fn()
  const onBlur = vi.fn()
  function Screen() {
    const [value, setValue] = useState(initial)
    const [negative, setNegative] = useState(initialNegative)
    return (
      <>
        <button type="button">앞</button>
        <AmountField
          label="시작 잔액"
          help="도움말 문장"
          error={error}
          value={value}
          onChange={(next) => {
            onChange(next)
            setValue(next)
          }}
          sign={signed ? { negative, onChange: setNegative } : undefined}
          readOnly={readOnly}
          onBlur={onBlur}
        />
        <button type="button">뒤</button>
      </>
    )
  }
  render(<Screen />)
  return { onChange, onBlur, user: userEvent.setup() }
}

const input = () => screen.getByLabelText<HTMLInputElement>('시작 잔액')
const signButton = () => screen.getByRole('button', { name: '마이너스' })
const selection = () => [input().selectionStart, input().selectionEnd]

/** 커서를 보이는 글자의 `position`번째에 둔다. */
function putCaret(position: number, end = position) {
  input().focus()
  input().setSelectionRange(position, end)
}

/** 칸 아래에 이어진 오류 문구. 없으면 없다. */
function errorOf(): string | undefined {
  if (!input().hasAttribute('aria-invalid')) return undefined
  return document.getElementById(input().getAttribute('aria-describedby')!.split(' ').at(-1)!)!.textContent
}

describe('금액 칸', () => {
  it('숫자 키패드를 띄우는 글자 칸이고, 이름과 "원"을 함께 읽는다', () => {
    renderField()
    expect(screen.getByRole('textbox', { name: '시작 잔액 원' })).toBe(input())
    expect(input().type).toBe('text')
    expect(input().getAttribute('inputmode')).toBe('numeric')
    expect(input().autocomplete).toBe('off')
  })

  it('"원"은 고정 글자이고 화면 낭독기가 따로 읽지 않으며 누르면 칸을 누른 것이다', () => {
    renderField()
    const unit = screen.getByText('원')
    expect(unit.getAttribute('aria-hidden')).toBe('true')
    expect(getComputedStyle(unit).pointerEvents).toBe('none')
    expect(getComputedStyle(unit).color).toBe('var(--color-text-secondary)')
  })

  it('오른쪽 정렬이고 숫자 폭이 같다', () => {
    renderField({ initial: 1000 })
    expect(getComputedStyle(input()).textAlign).toBe('end')
    expect(input().classList.contains('tabular-nums')).toBe(true)
  })

  it('도움말과 오류 문구를 칸에 잇는다', () => {
    renderField({ error: '금액을 입력해 주세요.' })
    const described = input()
      .getAttribute('aria-describedby')!
      .split(' ')
      .map((id) => document.getElementById(id)!.textContent)
    expect(described).toEqual(['도움말 문장', '금액을 입력해 주세요.'])
    expect(input().getAttribute('aria-invalid')).toBe('true')
  })

  it('부호를 고르지 않는 칸에는 버튼이 없다', () => {
    renderField()
    expect(screen.queryByRole('button', { name: '마이너스' })).toBeNull()
  })
})

describe('쓰기', () => {
  it('세 자리마다 쉼표를 보이고 값은 정수로 알린다', async () => {
    const { user, onChange } = renderField()
    await user.type(input(), '1234567')
    expect(input().value).toBe('1,234,567')
    expect(onChange.mock.calls.map(([value]) => value)).toEqual([1, 12, 123, 1234, 12345, 123456, 1234567])
  })

  it('커서는 방금 친 숫자 바로 뒤다', async () => {
    const { user } = renderField({ initial: 1234 })
    putCaret(1)
    await user.keyboard('5')
    expect(input().value).toBe('15,234')
    expect(selection()).toEqual([2, 2])
    await user.keyboard('6')
    expect(input().value).toBe('156,234')
    expect(selection()).toEqual([3, 3])
    await user.keyboard('7')
    expect(input().value).toBe('1,567,234')
    expect(selection()).toEqual([5, 5])
  })

  it('맨 뒤에 치면 커서가 맨 뒤다', async () => {
    const { user } = renderField({ initial: 999 })
    putCaret(3)
    await user.keyboard('9')
    expect(input().value).toBe('9,999')
    expect(selection()).toEqual([5, 5])
  })

  it.each(['a', '-', '.', ',', ' ', 'ㅁ', '５', '٣'])('숫자가 아닌 "%s"는 들어가지 않고 커서가 그대로다', async (key) => {
    const { user, onChange } = renderField({ initial: 1234 })
    putCaret(3)
    await user.keyboard(key)
    expect(input().value).toBe('1,234')
    expect(selection()).toEqual([3, 3])
    expect(onChange).not.toHaveBeenCalled()
  })

  it('숫자가 아닌 글자로는 고른 숫자가 지워지지 않는다', async () => {
    const { user, onChange } = renderField({ initial: 1234 })
    putCaret(0, 5)
    await user.keyboard('a')
    expect(input().value).toBe('1,234')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('고른 숫자를 새 숫자로 바꾼다', async () => {
    const { user } = renderField({ initial: 1234567 })
    putCaret(2, 5)
    await user.keyboard('8')
    expect(input().value).toBe('18,567')
    expect(selection()).toEqual([2, 2])
  })

  it('앞자리 0을 지운다', async () => {
    const { user } = renderField({ initial: 0 })
    putCaret(1)
    await user.keyboard('5')
    expect(input().value).toBe('5')
    putCaret(0)
    await user.keyboard('0')
    expect(input().value).toBe('5')
    expect(selection()).toEqual([0, 0])
  })

  it('모두 지우면 비고 값이 없다', async () => {
    const { user, onChange } = renderField({ initial: 5 })
    putCaret(1)
    await user.keyboard('{Backspace}')
    expect(input().value).toBe('')
    expect(onChange.mock.calls).toEqual([[undefined]])
  })

  it('0만 치면 0이다', async () => {
    const { user, onChange } = renderField()
    await user.type(input(), '000')
    expect(input().value).toBe('0')
    expect(onChange.mock.calls).toEqual([[0]])
  })

  it('화면이 준 값이 바뀌면 그 값을 보인다', () => {
    const field = (value: number) => <AmountField label="시작 잔액" value={value} onChange={() => {}} />
    const { rerender } = render(field(1000))
    rerender(field(25000))
    expect(input().value).toBe('25,000')
  })

  it('브라우저가 값을 통째로 바꿔도(자동 완성 등) 숫자만 남긴다', () => {
    const { onChange } = renderField()
    fireEvent.change(input(), { target: { value: '₩ 12,345원' } })
    expect(input().value).toBe('12,345')
    expect(onChange.mock.calls).toEqual([[12345]])
  })
})

describe('지우기', () => {
  it('쉼표 바로 뒤에서 지우면 쉼표 앞의 숫자를 지운다', async () => {
    const { user } = renderField({ initial: 1234567 })
    putCaret(6)
    await user.keyboard('{Backspace}')
    expect(input().value).toBe('123,567')
    expect(selection()).toEqual([3, 3])
  })

  it('쉼표 앞의 숫자가 하나뿐이어도 지운다', async () => {
    const { user } = renderField({ initial: 1234 })
    putCaret(2)
    await user.keyboard('{Backspace}')
    expect(input().value).toBe('234')
    expect(selection()).toEqual([0, 0])
  })

  it('쉼표 바로 앞에서 뒤로 지우면 쉼표 뒤의 숫자를 지운다', async () => {
    const { user } = renderField({ initial: 1234 })
    putCaret(1)
    await user.keyboard('{Delete}')
    expect(input().value).toBe('134')
    expect(selection()).toEqual([1, 1])
  })

  it('숫자 뒤에서 지우면 그 숫자를 지우고 커서를 그 자리에 둔다', async () => {
    const { user } = renderField({ initial: 12345 })
    putCaret(4)
    await user.keyboard('{Backspace}')
    expect(input().value).toBe('1,245')
    expect(selection()).toEqual([3, 3])
  })

  it('맨 앞에서 지우면 그대로다', async () => {
    const { user, onChange } = renderField({ initial: 1234 })
    putCaret(0)
    await user.keyboard('{Backspace}')
    expect(input().value).toBe('1,234')
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('최대', () => {
  it('10자리까지 들어간다', async () => {
    const { user, onChange } = renderField()
    await user.type(input(), '9999999999')
    expect(input().value).toBe('9,999,999,999')
    expect(onChange).toHaveBeenLastCalledWith(9_999_999_999)
    expect(errorOf()).toBeUndefined()
  })

  it('11번째 숫자는 들어가지 않고 커서를 그대로 두며 칸 아래에 알린다', async () => {
    const { user, onChange } = renderField({ initial: 1234567890 })
    putCaret(5)
    await user.keyboard('1')
    expect(input().value).toBe('1,234,567,890')
    expect(selection()).toEqual([5, 5])
    expect(onChange).not.toHaveBeenCalled()
    expect(errorOf()).toBe(tooLarge)
  })

  it('알린 문구는 고치면 사라진다', async () => {
    const { user } = renderField({ initial: 1234567890 })
    putCaret(13)
    await user.keyboard('1')
    expect(errorOf()).toBe(tooLarge)
    await user.keyboard('{Backspace}')
    expect(errorOf()).toBeUndefined()
  })

  it('알린 문구는 칸을 벗어나면 사라진다. 들어 있는 값은 맞다', async () => {
    const { user, onBlur } = renderField({ initial: 1234567890 })
    putCaret(13)
    await user.keyboard('1')
    await user.tab()
    expect(errorOf()).toBeUndefined()
    expect(onBlur).toHaveBeenCalledTimes(1)
  })

  it('숫자가 아닌 글자로는 사라지지 않는다', async () => {
    const { user } = renderField({ initial: 1234567890 })
    putCaret(13)
    await user.keyboard('1a')
    expect(errorOf()).toBe(tooLarge)
  })

  it('화면이 준 오류보다 먼저 보인다', async () => {
    const { user } = renderField({ error: '금액을 입력해 주세요.' })
    putCaret(0)
    await user.paste('12345678901')
    expect(errorOf()).toBe(tooLarge)
  })
})

describe('붙여넣기', () => {
  it.each([
    ['12,000원', '12,000', 12000],
    ['₩ 1 234', '1,234', 1234],
    ['-5,000', '5,000', 5000],
    ['0012', '12', 12],
    ['00000000012000', '12,000', 12000],
    ['12,000.50', '1,200,050', 1200050],
    ['１２345', '345', 345],
  ])('"%s"는 숫자만 골라 넣는다', async (text, shown, value) => {
    const { user, onChange } = renderField()
    putCaret(0)
    await user.paste(text)
    expect(input().value).toBe(shown)
    expect(onChange.mock.calls).toEqual([[value]])
  })

  it('커서 자리에 넣고 커서를 넣은 숫자 뒤에 둔다', async () => {
    const { user } = renderField({ initial: 1234 })
    putCaret(3)
    await user.paste('56원')
    expect(input().value).toBe('125,634')
    expect(selection()).toEqual([5, 5])
  })

  it('고른 부분을 바꾼다', async () => {
    const { user } = renderField({ initial: 1234567 })
    putCaret(0, 5)
    await user.paste('9')
    expect(input().value).toBe('9,567')
    expect(selection()).toEqual([1, 1])
  })

  it('숫자가 하나도 없으면 고른 부분도 그대로다', async () => {
    const { user, onChange } = renderField({ initial: 1234 })
    putCaret(0, 5)
    await user.paste('없음 -')
    expect(input().value).toBe('1,234')
    expect(onChange).not.toHaveBeenCalled()
    expect(errorOf()).toBeUndefined()
  })

  it.each([
    ['11자리', undefined, '12345678901'],
    ['넣으면 11자리', 123456, '78901'],
  ])('%s는 넣지 않고 알린다', async (_, initial, text) => {
    const { user, onChange } = renderField({ initial })
    const shown = input().value
    putCaret(shown.length)
    await user.paste(text)
    expect(input().value).toBe(shown)
    expect(selection()).toEqual([shown.length, shown.length])
    expect(onChange).not.toHaveBeenCalled()
    expect(errorOf()).toBe(tooLarge)
  })

  it('숫자를 11자리로 만드는 붙여넣기도 고른 부분을 바꾸고 나면 10자리면 넣는다', async () => {
    const { user } = renderField({ initial: 1234567890 })
    putCaret(0, 13)
    await user.paste('9999999999')
    expect(input().value).toBe('9,999,999,999')
    expect(errorOf()).toBeUndefined()
  })
})

describe('초점을 받을 때', () => {
  it('값이 0이면 모두 고르고, 바로 치면 바뀐다', async () => {
    const { user } = renderField({ initial: 0 })
    act(() => input().focus())
    expect(selection()).toEqual([0, 1])
    await user.keyboard('350000')
    expect(input().value).toBe('350,000')
  })

  it('"-0"도 부호까지 고르고, 치면 부호가 남는다', async () => {
    const { user } = renderField({ initial: 0, signed: true, negative: true })
    act(() => input().focus())
    expect(selection()).toEqual([0, 2])
    await user.keyboard('5')
    expect(input().value).toBe('-5')
    expect(selection()).toEqual([2, 2])
  })

  it('눌러서 받아도 값이 0이면 모두 고른다. 브라우저가 누른 자리에 커서를 놓은 뒤다', () => {
    renderField({ initial: 0 })
    fireEvent.mouseDown(input())
    input().focus()
    input().setSelectionRange(1, 1)
    fireEvent.mouseUp(input())
    fireEvent.click(input())
    expect(selection()).toEqual([0, 1])
  })

  it('이미 초점이 있는 칸을 누르면 커서를 그대로 둔다', () => {
    renderField({ initial: 0 })
    input().focus()
    fireEvent.mouseDown(input())
    input().setSelectionRange(1, 1)
    fireEvent.click(input())
    expect(selection()).toEqual([1, 1])
  })

  it('쓴 값이 있으면 고르지 않는다', () => {
    renderField({ initial: 1234 })
    const select = vi.spyOn(HTMLInputElement.prototype, 'setSelectionRange')
    const selectAll = vi.spyOn(HTMLInputElement.prototype, 'select')
    fireEvent.mouseDown(input())
    input().focus()
    fireEvent.click(input())
    expect(select).not.toHaveBeenCalled()
    expect(selectAll).not.toHaveBeenCalled()
  })
})

describe('부호', () => {
  it('버튼은 "+/-"로 고정이고 누르면 값 앞에 "-"를 보인다. 값은 그대로다', async () => {
    const { user, onChange } = renderField({ initial: 350000, signed: true })
    expect(signButton().textContent).toBe('+/-')
    expect(signButton().getAttribute('aria-pressed')).toBe('false')
    await user.click(signButton())
    expect(input().value).toBe('-350,000')
    expect(signButton().textContent).toBe('+/-')
    expect(signButton().getAttribute('aria-pressed')).toBe('true')
    await user.click(signButton())
    expect(input().value).toBe('350,000')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('칸보다 앞에 있고 칸과 같은 줄에서 8px 떨어진다', () => {
    renderField({ signed: true })
    expect(signButton().compareDocumentPosition(input())).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    const row = getComputedStyle(signButton().parentElement!)
    expect(row.display).toBe('flex')
    expect(row.alignItems).toBe('center')
    expect(row.gap).toBe('var(--space-8)')
  })

  it('44x44px 보조 버튼이고 눌린 모양을 따로 두지 않는다', async () => {
    const { user } = renderField({ signed: true })
    const look = () => {
      const { width, minHeight, padding, backgroundColor, color, font } = getComputedStyle(signButton())
      return { width, minHeight, padding, backgroundColor, color, font }
    }
    const before = look()
    expect(before).toMatchObject({
      width: 'var(--size-touch)',
      minHeight: 'var(--size-button-secondary)',
      padding: '0px',
      backgroundColor: 'var(--color-surface)',
      color: 'var(--color-text)',
      font: 'var(--text-body-strong)',
    })
    await user.click(signButton())
    expect(look()).toEqual(before)
  })

  it('"-"는 지우기로 지워지지 않는다', async () => {
    const { user, onChange } = renderField({ initial: 350, signed: true, negative: true })
    putCaret(1)
    await user.keyboard('{Backspace}')
    expect(input().value).toBe('-350')
    expect(selection()).toEqual([1, 1])
    putCaret(0)
    await user.keyboard('{Delete}')
    expect(input().value).toBe('-350')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('모두 골라 지워도 "-"는 남는다', async () => {
    const { user, onChange } = renderField({ initial: 350, signed: true, negative: true })
    putCaret(0, 4)
    await user.keyboard('{Backspace}')
    expect(input().value).toBe('-')
    expect(selection()).toEqual([1, 1])
    expect(onChange.mock.calls).toEqual([[undefined]])
    await user.keyboard('7')
    expect(input().value).toBe('-7')
  })

  it('"-" 앞에 쳐도 숫자가 "-" 뒤로 들어간다', async () => {
    const { user } = renderField({ initial: 350, signed: true, negative: true })
    putCaret(0)
    await user.keyboard('1')
    expect(input().value).toBe('-1,350')
    expect(selection()).toEqual([2, 2])
  })

  it('"-"를 쳐도 부호가 바뀌지 않는다', async () => {
    const { user } = renderField({ initial: 350, signed: true })
    putCaret(0)
    await user.keyboard('-')
    expect(input().value).toBe('350')
    expect(signButton().getAttribute('aria-pressed')).toBe('false')
  })

  it('쉼표 바로 뒤에서 지우는 것도 같다', async () => {
    const { user } = renderField({ initial: 1234, signed: true, negative: true })
    putCaret(3)
    await user.keyboard('{Backspace}')
    expect(input().value).toBe('-234')
    expect(selection()).toEqual([1, 1])
  })

  it('음수를 붙여넣어도 부호는 그대로다', async () => {
    const { user } = renderField({ signed: true })
    putCaret(0)
    await user.paste('-5,000')
    expect(input().value).toBe('5,000')
  })
})

describe('한글 조합', () => {
  function compose(text: string) {
    const typed = input().value.slice(0, input().selectionStart!) + text + input().value.slice(input().selectionEnd!)
    fireEvent.compositionStart(input())
    const event = createEvent.input(input(), { target: { value: typed } })
    Object.defineProperties(event, {
      isComposing: { value: true },
      inputType: { value: 'insertCompositionText' },
      data: { value: text },
    })
    fireEvent(input(), event)
  }

  it('조합하는 동안에는 건드리지 않고, 끝나면 숫자가 아닌 글자를 뺀다', () => {
    const { onChange } = renderField({ initial: 1234 })
    putCaret(5)
    compose('마')
    expect(input().value).toBe('1,234마')
    fireEvent.compositionEnd(input(), { data: '마' })
    expect(input().value).toBe('1,234')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('고른 숫자에 조합해도 숫자가 지워지지 않는다', () => {
    const { onChange } = renderField({ initial: 0 })
    putCaret(0, 1)
    compose('ㅁ')
    fireEvent.compositionEnd(input(), { data: 'ㅁ' })
    expect(input().value).toBe('0')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('조합이 끝난 뒤에 오는 입력 알림(Firefox)도 같다', () => {
    const { onChange } = renderField({ initial: 1234 })
    putCaret(5)
    compose('마')
    fireEvent.compositionEnd(input(), { data: '마' })
    const event = createEvent.input(input())
    Object.defineProperties(event, {
      isComposing: { value: false },
      inputType: { value: 'insertCompositionText' },
      data: { value: '마' },
    })
    fireEvent(input(), event)
    expect(input().value).toBe('1,234')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('조합으로 들어온 숫자는 받는다', () => {
    const { onChange } = renderField()
    putCaret(0)
    compose('1500')
    expect(input().value).toBe('1500')
    fireEvent.compositionEnd(input(), { data: '1500' })
    expect(input().value).toBe('1,500')
    expect(onChange.mock.calls).toEqual([[1500]])
  })

  it('조합으로 들어온 전각 숫자는 받지 않는다', () => {
    const { onChange } = renderField()
    putCaret(0)
    compose('１５')
    fireEvent.compositionEnd(input(), { data: '１５' })
    expect(input().value).toBe('')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('조합이 끝난 뒤에 이어서 칠 수 있다', async () => {
    const { user } = renderField({ initial: 12 })
    putCaret(2)
    compose('ㅁ')
    fireEvent.compositionEnd(input(), { data: 'ㅁ' })
    await user.keyboard('3')
    expect(input().value).toBe('123')
  })
})

describe('읽기 전용', () => {
  it('칸과 부호 버튼의 모양을 그대로 두고 값과 부호가 바뀌지 않는다', async () => {
    const { user, onChange } = renderField({ initial: 1234, signed: true, readOnly: true })
    expect(input().readOnly).toBe(true)
    expect(signButton().hasAttribute('aria-disabled')).toBe(false)
    await user.click(signButton())
    expect(input().value).toBe('1,234')
    putCaret(0, 5)
    await user.keyboard('5')
    await user.paste('999')
    expect(input().value).toBe('1,234')
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('모양', () => {
  it('오른쪽 끝의 "원" 자리를 비우고 글자를 오른쪽에 맞춘다', () => {
    expect(readCssRule(CSS, '.input')).toContain('padding-inline-end: calc(var(--space-12) + 1em + var(--space-8))')
    expect(readCssRule(CSS, '.unit')).toContain('inset-inline-end: calc(var(--space-12) + 1px)')
  })
})
