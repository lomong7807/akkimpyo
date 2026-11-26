import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DateField from '../src/components/DateField'
import { TextField } from '../src/components/TextField'
import { setDeviceClock } from './support/clock'
import { readCssRule } from './support/cssRule'
import { shield, untilOpened, untilUnshielded } from './support/dialog'
import { startGuardClock, stopGuardClock } from './support/guardClock'
import { installMatchMedia } from './support/viewport'

const PHONE = 390
const WIDE = 1280

let viewport: ReturnType<typeof installMatchMedia>

beforeEach(() => {
  setDeviceClock('2026-11-26T12:00:00+09:00')
  startGuardClock()
  viewport = installMatchMedia(PHONE)
})

afterEach(() => {
  cleanup()
  stopGuardClock()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

type Props = Partial<ComponentProps<typeof DateField>>

function Sample({ value: initial = '2026-11-26', onChange, ...props }: Props) {
  const [value, setValue] = useState(initial)
  return (
    <DateField
      label="기준일"
      {...props}
      value={value}
      onChange={(next) => {
        onChange?.(next)
        setValue(next)
      }}
    />
  )
}

const field = () => screen.getByLabelText<HTMLButtonElement>('기준일', { selector: 'button' })
const dialog = () => screen.queryByRole<HTMLDialogElement>('dialog')
const day = (name: string) => screen.getByRole('gridcell', { name: new RegExp(`^${name} .요일$`) })

function described() {
  return (field().getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent)
}

/** 다 열려 날짜를 누를 수 있을 때까지 기다린다. */
async function open(props: Props = {}) {
  const user = userEvent.setup()
  render(<Sample {...props} />)
  await user.click(field())
  if (dialog()) await untilOpened()
  return user
}

describe('칸', () => {
  it.each([
    ['2026-11-26', '11월 26일 (목)'],
    ['2026-01-01', '1월 1일 (목)'],
    ['2025-12-31', '2025년 12월 31일'],
    ['2027-01-01', '2027년 1월 1일'],
  ])('값 %s을 "%s"로 보인다', (value, text) => {
    render(<Sample value={value} />)
    expect(field().textContent).toBe(text)
  })

  it('값이 비면 아무 글자도 두지 않는다', () => {
    render(<Sample value="" />)
    expect(field().textContent).toBe('')
  })

  it('대화 상자를 여는 버튼이고 화면 낭독기는 이름과 값을 읽는다', () => {
    render(<Sample />)
    expect(field().type).toBe('button')
    expect(field().getAttribute('aria-haspopup')).toBe('dialog')
    expect(screen.getByRole('button', { name: '기준일 11월 26일 (목)' })).toBe(field())
  })

  it('값이 비면 이름만 읽는다', () => {
    render(<Sample value="" />)
    expect(screen.getByRole('button', { name: '기준일' })).toBe(field())
  })

  it('이름은 label로 칸과 묶인다', () => {
    render(<Sample />)
    expect(screen.getByText('기준일').tagName).toBe('LABEL')
    expect(field().labels).toContain(screen.getByText('기준일'))
  })

  it('도움말과 오류 문구를 설명으로 잇는다. 버튼에 없는 aria-invalid는 쓰지 않는다', () => {
    render(<Sample help="도움말 문장" error="오류 문장" />)
    expect(described()).toEqual(['도움말 문장', '오류 문장'])
    expect(field().hasAttribute('aria-invalid')).toBe(false)
  })

  it('도움말과 오류가 없으면 설명이 없다', () => {
    render(<Sample />)
    expect(field().hasAttribute('aria-describedby')).toBe(false)
  })

  it('열려 있는지 알린다', async () => {
    const user = await open()
    expect(field().getAttribute('aria-expanded')).toBe('true')
    await user.keyboard('{Escape}')
    expect(field().getAttribute('aria-expanded')).toBe('false')
  })

  it('오류 칸으로 초점을 옮길 수 있게 ref를 받는다', () => {
    let button: HTMLButtonElement | null = null
    render(
      <Sample
        ref={(element) => {
          button = element
        }}
      />,
    )
    expect(button).toBe(field())
    button!.focus()
    expect(document.activeElement).toBe(field())
  })

  it('양식 안에서 열어도 양식을 보내지 않는다', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(
      <form onSubmit={onSubmit}>
        <Sample />
      </form>,
    )
    await user.click(field())
    await untilOpened()
    await user.click(day('2026년 11월 3일'))
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('고르기', () => {
  describe.each([
    ['휴대폰 배치', PHONE],
    ['넓은 화면', WIDE],
  ])('%s', (_, width) => {
    beforeEach(() => {
      viewport = installMatchMedia(width)
    })

    it('누르면 달력이 열리고 고른 날에 초점이 간다', async () => {
      await open({ value: '2026-11-20' })
      expect(screen.getByRole('dialog', { name: '기준일' })).toBeTruthy()
      expect(document.activeElement).toBe(day('2026년 11월 20일'))
    })

    it.each([
      ['비어 있으면', ''],
      ['범위 밖이면', '1999-12-31'],
    ])('값이 %s 오늘에 초점이 간다', async (_, value) => {
      await open({ value })
      expect(document.activeElement).toBe(day('2026년 11월 26일'))
    })

    it('날짜를 누르면 값이 되고 닫히며 초점이 칸으로 돌아간다', async () => {
      const onChange = vi.fn()
      const user = await open({ onChange })
      await user.click(day('2026년 11월 3일'))
      expect(onChange.mock.calls).toEqual([['2026-11-03']])
      expect(dialog()).toBeNull()
      expect(field().textContent).toBe('11월 3일 (화)')
      expect(document.activeElement).toBe(field())
    })

    it('"오늘"을 누르면 오늘이 값이 되고 닫힌다', async () => {
      const onChange = vi.fn()
      const user = await open({ value: '', onChange })
      await user.click(screen.getByRole('button', { name: '오늘' }))
      expect(onChange.mock.calls).toEqual([['2026-11-26']])
      expect(dialog()).toBeNull()
      expect(document.activeElement).toBe(field())
    })

    it('Esc로 닫으면 값이 그대로이고 초점이 칸으로 돌아간다', async () => {
      const onChange = vi.fn()
      const user = await open({ onChange })
      await user.keyboard('{ArrowLeft}{Escape}')
      expect(onChange).not.toHaveBeenCalled()
      expect(dialog()).toBeNull()
      expect(document.activeElement).toBe(field())
    })

    it('바깥을 눌러 닫으면 값이 그대로다', async () => {
      const onChange = vi.fn()
      const user = await open({ onChange })
      await user.click(dialog()!)
      expect(onChange).not.toHaveBeenCalled()
      expect(dialog()).toBeNull()
    })

    it.each(['{Enter}', ' '])('키보드 "%s"로 열고 고른다', async (key) => {
      const user = userEvent.setup()
      render(<Sample />)
      await user.tab()
      expect(document.activeElement).toBe(field())
      await user.keyboard(key)
      expect(document.activeElement).toBe(day('2026년 11월 26일'))
      await user.keyboard('{ArrowUp}')
      await user.keyboard(key)
      expect(field().textContent).toBe('11월 19일 (목)')
      expect(document.activeElement).toBe(field())
    })

    it.each([
      ['눌러서', false],
      ['키보드로', true],
    ])('%s 열면 초점 테두리를 보이는지가 %s이다', async (_, visible) => {
      const focus = vi.spyOn(HTMLElement.prototype, 'focus')
      // 칸에 초점 테두리가 보이는지는 브라우저가 정한다
      const matches = Element.prototype.matches
      vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector) {
        return selector === ':focus-visible' ? visible : matches.call(this, selector)
      })
      await open()
      const moved = focus.mock.contexts.indexOf(day('2026년 11월 26일'))
      expect(focus.mock.calls[moved]).toEqual([{ focusVisible: visible }])
    })

    it('다시 열면 새 값에서 시작한다', async () => {
      const user = await open()
      await user.click(day('2026년 11월 3일'))
      await user.click(field())
      expect(document.activeElement).toBe(day('2026년 11월 3일'))
      expect(day('2026년 11월 3일').getAttribute('aria-selected')).toBe('true')
    })

    it('닫았다 열면 보던 달이 아니라 고른 날의 달을 연다', async () => {
      const user = await open()
      await user.click(screen.getByRole('button', { name: '다음 달' }))
      await user.keyboard('{Escape}')
      await user.click(field())
      expect(screen.getByRole('grid', { name: '11월' })).toBeTruthy()
    })

    it('여는 순간의 오늘을 다시 읽는다', async () => {
      const user = userEvent.setup()
      setDeviceClock('2026-11-26T23:59:00+09:00')
      render(<Sample value="" />)
      setDeviceClock('2026-11-27T00:00:00+09:00')
      await user.click(field())
      expect(day('2026년 11월 27일').getAttribute('aria-current')).toBe('date')
      expect(document.activeElement).toBe(day('2026년 11월 27일'))
    })

    it('열리는 동안 이어서 눌러도 날짜가 골라지지 않고 열려 있다', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(<Sample onChange={onChange} />)
      await user.click(field())
      // 칸이 시트가 덮는 자리에 있으면 둘째 누름이 올라온 달력에 닿는다
      for (const target of [day('2026년 11월 3일'), screen.getByRole('button', { name: '오늘' }), screen.getByRole('button', { name: '다음 달' })]) {
        expect(getComputedStyle(target).pointerEvents).toBe('none')
      }
      await user.click(dialog()!)
      expect(dialog()?.open).toBe(true)
      expect(onChange).not.toHaveBeenCalled()
      await untilOpened()
      await user.click(day('2026년 11월 3일'))
      expect(onChange.mock.calls).toEqual([['2026-11-03']])
    })

    it('고른 뒤 이어서 누른 것이 뒤 화면에 닿지 않게 덮었다가 푼다', async () => {
      const user = await open()
      await user.click(day('2026년 11월 3일'))
      expect(shield()).toBeTruthy()
      expect(document.activeElement).toBe(field())
      await untilUnshielded()
    })

    it.each(['Enter', ' '])('고른 키 "%s"를 누르고 있어도 다시 열리지 않는다', async (key) => {
      await open()
      for (const repeat of [false, true, true]) {
        const event = new KeyboardEvent('keydown', { key, repeat, bubbles: true, cancelable: true })
        await act(async () => void document.activeElement!.dispatchEvent(event))
        // 막지 않으면 브라우저가 칸을 누른 것으로 본다
        expect(event.defaultPrevented).toBe(true)
      }
      expect(dialog()).toBeNull()
      expect(document.activeElement).toBe(field())
    })

    it('창의 폭이 1024px을 넘나들면 닫히고 초점이 칸으로 돌아간다', async () => {
      await open()
      await act(async () => viewport.resizeTo(width === PHONE ? WIDE : PHONE))
      expect(dialog()).toBeNull()
      expect(document.activeElement).toBe(field())
    })

    it('1024px을 넘지 않는 크기 변화에는 열려 있다', async () => {
      await open()
      await act(async () => viewport.resizeTo(width === PHONE ? 844 : 1024))
      expect(dialog()).toBeTruthy()
    })
  })

  it('휴대폰 배치에서는 제목과 닫기가 있는 시트다', async () => {
    const user = await open()
    expect(screen.getByRole('heading', { name: '기준일' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '닫기' }))
    expect(dialog()).toBeNull()
  })

  it('넓은 화면에서는 머리가 없는 판이다', async () => {
    viewport = installMatchMedia(1024)
    await open()
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.queryByRole('button', { name: '닫기' })).toBeNull()
  })

  it('폭이 바뀌어 닫힌 뒤 다시 열면 바뀐 배치로 연다', async () => {
    const user = await open()
    await act(async () => viewport.resizeTo(WIDE))
    await user.click(field())
    expect(screen.queryByRole('heading')).toBeNull()
  })

  it('누를 때 버튼에 초점을 주지 않는 브라우저에서도 초점이 칸으로 돌아간다', async () => {
    const user = userEvent.setup()
    render(<Sample />)
    // Safari처럼 누르는 동안 초점이 옮겨지지 않게 한다
    field().addEventListener('mousedown', (event) => event.preventDefault())
    await user.click(field())
    await user.keyboard('{Escape}')
    expect(document.activeElement).toBe(field())
  })
})

it.each([
  ['처음 누른 Enter', 'Enter', false],
  ['누르고 있는 Tab', 'Tab', true],
])('칸에서 %s는 브라우저에 맡긴다', (_, key, repeat) => {
  render(<Sample />)
  const event = new KeyboardEvent('keydown', { key, repeat, bubbles: true, cancelable: true })
  field().dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false)
})

describe('읽기 전용', () => {
  it('눌러도 열리지 않고 화면 낭독기에 알리며 초점은 받는다', async () => {
    const user = await open({ readOnly: true })
    expect(dialog()).toBeNull()
    expect(field().getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(field())
    await user.keyboard('{Enter}')
    expect(dialog()).toBeNull()
  })

  it('읽기 전용이 아니면 표시가 없다', () => {
    render(<Sample />)
    expect(field().hasAttribute('aria-disabled')).toBe(false)
  })
})

describe('모양', () => {
  it('오른쪽에 장식 아이콘 20px을 그린다', () => {
    render(<Sample />)
    const icon = field().lastElementChild!
    expect(icon.getAttribute('aria-hidden')).toBe('true')
    expect(getComputedStyle(icon).width).toBe('var(--size-icon-20)')
  })

  it('숫자의 폭이 같다', () => {
    render(<Sample />)
    expect(screen.getByText('11월 26일 (목)').classList.contains('tabular-nums')).toBe(true)
  })

  it.each([
    ['평소', false, undefined],
    ['초점', true, undefined],
    ['오류', false, '오류 문장'],
    ['오류 칸의 초점', true, '오류 문장'],
  ])('%s일 때의 테두리는 입력칸과 같다', (_, focused, error) => {
    const look = (element: HTMLElement) => {
      if (focused) element.focus()
      const style = getComputedStyle(element)
      return [
        ...['--border-width', '--border-color'].map((name) => style.getPropertyValue(name)),
        style.border,
        style.borderRadius,
        style.backgroundColor,
        style.color,
        style.font,
        style.paddingInline,
        style.outlineColor,
      ]
    }
    render(
      <>
        <TextField label="이메일" error={error} />
        <Sample error={error} />
      </>,
    )
    expect(look(field())).toEqual(look(screen.getByLabelText('이메일')))
  })

  it('높이는 48px이고 글자를 키워 두 줄이 되면 늘어난다', () => {
    render(<Sample />)
    const style = getComputedStyle(field())
    expect(style.minHeight).toBe('var(--size-field)')
    expect(style.height).toBe('auto')
  })

  it('값은 왼쪽, 아이콘은 오른쪽 끝이다', () => {
    expect(readCssRule('src/components/FieldButton.module.css', '.button')).toContain('justify-content: space-between')
    expect(readCssRule('src/components/FieldButton.module.css', '.button')).toContain('text-align: start')
  })
})
