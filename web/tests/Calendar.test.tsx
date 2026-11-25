import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Calendar from '../src/components/Calendar'
import { readCssRule } from './support/cssRule'

const rule = (selector: string) => readCssRule('src/components/Calendar.module.css', selector)

/** 기기의 오늘이 되는 순간을 정한다. 시각은 기기의 시간대다. */
function deviceToday(year: number, month: number, day: number, hour = 12, minute = 0) {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(year, month - 1, day, hour, minute) })
}

function open(value: string) {
  const onSelect = vi.fn()
  render(<Calendar value={value} focusVisible onSelect={onSelect} />)
  return { onSelect, user: userEvent.setup() }
}

const grid = () => screen.getByRole('grid')
const day = (name: string) => screen.getByRole('gridcell', { name: new RegExp(`^${name} .요일$`) })
const days = () => screen.getAllByRole('gridcell', { name: /일 .요일$/ })
const focused = () => document.activeElement?.getAttribute('aria-label')
const previous = () => screen.queryByRole('button', { name: '이전 달' })
const next = () => screen.queryByRole('button', { name: '다음 달' })

beforeEach(() => deviceToday(2026, 11, 26))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('한 달', () => {
  it('고른 날이 속한 달을 연다. 올해의 달은 "M월"이다', () => {
    open('2026-11-20')
    expect(screen.getByRole('grid', { name: '11월' })).toBeTruthy()
    expect(days()).toHaveLength(30)
  })

  it('올해가 아닌 달은 연도를 붙인다', () => {
    open('2025-12-25')
    expect(screen.getByRole('grid', { name: '2025년 12월' })).toBeTruthy()
  })

  it.each([
    ['비어 있으면', ''],
    ['범위보다 앞이면', '1999-12-31'],
    ['범위보다 뒤면', '2027-11-27'],
  ])('고른 날이 %s 오늘이 속한 달을 연다', (_, value) => {
    open(value)
    expect(screen.getByRole('grid', { name: '11월' })).toBeTruthy()
    expect(focused()).toBe('2026년 11월 26일 목요일')
  })

  it('요일은 일요일부터 한 글자로 보이고 화면 낭독기는 요일 이름으로 읽는다', () => {
    open('2026-11-20')
    const headers = screen.getAllByRole('columnheader')
    expect(headers.map((header) => header.textContent)).toEqual(['일', '월', '화', '수', '목', '금', '토'])
    for (const name of ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일']) {
      expect(screen.getByRole('columnheader', { name })).toBeTruthy()
    }
  })

  it('요일의 색은 모두 같다', () => {
    open('2026-11-20')
    const colors = screen.getAllByRole('columnheader').map((header) => getComputedStyle(header).color)
    expect(new Set(colors)).toEqual(new Set(['var(--color-text-secondary)']))
  })

  it('날짜는 제 요일 아래에 놓인다', () => {
    open('2026-11-20')
    for (const cell of days()) {
      const column = [...cell.parentElement!.children].indexOf(cell)
      const weekday = screen.getAllByRole('columnheader')[column].getAttribute('aria-label')
      expect(cell.getAttribute('aria-label')).toMatch(new RegExp(` ${weekday}$`))
    }
  })

  it('날짜마다 이름은 날짜 전체이고 글자는 일이다', () => {
    open('2026-11-20')
    expect(day('2026년 11월 1일').textContent).toBe('1')
    expect(day('2026년 11월 1일').getAttribute('aria-label')).toBe('2026년 11월 1일 일요일')
    expect(day('2026년 11월 30일').getAttribute('aria-label')).toBe('2026년 11월 30일 월요일')
  })

  it.each([
    ['네 줄인 2026년 2월', '2026-02-10', 28],
    ['다섯 줄인 2026년 11월', '2026-11-20', 30],
    ['여섯 줄인 2026년 8월', '2026-08-10', 31],
    ['윤년인 2028년 2월', '2028-02-10', 29],
  ])('%s도 여섯 줄 자리를 두고 다른 달의 날짜는 빈칸이다', (_, value, count) => {
    deviceToday(2027, 6, 1)
    open(value)
    const rows = [...grid().querySelectorAll('tbody tr')]
    expect(rows).toHaveLength(6)
    expect(rows.every((row) => row.children.length === 7)).toBe(true)
    const texts = rows.flatMap((row) => [...row.children]).map((cell) => cell.textContent)
    expect(texts.filter(Boolean)).toEqual(Array.from({ length: count }, (_, index) => String(index + 1)))
    expect(texts.filter((text) => text === '')).toHaveLength(42 - count)
  })

  it('고른 날과 오늘을 화면 낭독기에 알린다', () => {
    open('2026-11-20')
    expect(days().filter((cell) => cell.getAttribute('aria-selected') === 'true')).toEqual([day('2026년 11월 20일')])
    expect(days().filter((cell) => cell.getAttribute('aria-current') === 'date')).toEqual([day('2026년 11월 26일')])
  })

  it('값이 비어 있으면 고른 날이 없다', () => {
    open('')
    expect(document.querySelector('[aria-selected]')).toBeNull()
  })

  it('다른 달에는 고른 날과 오늘 표시가 없다', async () => {
    const { user } = open('2026-11-20')
    await user.click(next()!)
    expect(document.querySelector('[aria-selected], [aria-current]')).toBeNull()
  })
})

describe('달 이동', () => {
  it('이전 달과 다음 달로 옮기고, 해가 바뀌면 연도가 붙는다', async () => {
    const { user } = open('2026-11-20')
    await user.click(next()!)
    expect(screen.getByRole('grid', { name: '12월' })).toBeTruthy()
    await user.click(next()!)
    expect(screen.getByRole('grid', { name: '2027년 1월' })).toBeTruthy()
    await user.click(previous()!)
    await user.click(previous()!)
    await user.click(previous()!)
    expect(screen.getByRole('grid', { name: '10월' })).toBeTruthy()
  })

  it('달이 바뀌면 화면 낭독기에 알린다', async () => {
    const { user } = open('2026-11-20')
    const month = screen.getByText('11월')
    expect(month.getAttribute('aria-live')).toBe('polite')
    await user.click(next()!)
    expect(month.textContent).toBe('12월')
    expect(month.isConnected).toBe(true)
  })

  it('버튼을 누르면 초점은 버튼에 남고, 달력에는 옮긴 달의 같은 날로 들어간다', async () => {
    const { user } = open('2026-11-20')
    await user.click(next()!)
    expect(document.activeElement).toBe(next())
    expect(day('2026년 12월 20일').tabIndex).toBe(0)
  })

  it('달을 옮기기만 해서는 고르지 않는다', async () => {
    const { user, onSelect } = open('2026-11-20')
    await user.click(next()!)
    await user.click(previous()!)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('범위의 처음 달에는 이전 달 버튼이, 마지막 달에는 다음 달 버튼이 없다', () => {
    open('2000-01-15')
    expect(previous()).toBeNull()
    expect(next()).toBeTruthy()
    cleanup()
    open('2027-11-10')
    expect(previous()).toBeTruthy()
    expect(next()).toBeNull()
  })

  it.each([
    ['처음 달', '2000-01-15'],
    ['가운데 달', '2026-11-20'],
    ['마지막 달', '2027-11-10'],
  ])('%s에서도 버튼 자리는 남아 달 이름이 가운데에 있다', (_, value) => {
    open(value)
    const bar = document.querySelector('[aria-live]')!.parentElement!
    expect(bar.children).toHaveLength(3)
    expect(bar.children[1].hasAttribute('aria-live')).toBe(true)
    expect(getComputedStyle(bar).gridTemplateColumns).toBe('var(--size-touch) 1fr var(--size-touch)')
  })

  it('끝 달에 닿아 누른 버튼이 사라지면 초점을 달력의 날짜로 옮긴다', async () => {
    const { user } = open('2027-10-31')
    await user.click(next()!)
    expect(next()).toBeNull()
    // 2027-11-30은 범위 밖이라 마지막 날로 당긴다
    expect(focused()).toBe('2027년 11월 26일 금요일')
    cleanup()
    open('2000-02-29')
    await user.click(previous()!)
    expect(previous()).toBeNull()
    expect(focused()).toBe('2000년 1월 29일 토요일')
  })
})

describe('고를 수 있는 범위', () => {
  it('오늘로부터 1년 뒤까지 고르고 그 뒤는 누를 수 없다', async () => {
    const { user, onSelect } = open('2027-11-10')
    const last = day('2027년 11월 26일')
    const outside = day('2027년 11월 27일')
    expect(last.hasAttribute('aria-disabled')).toBe(false)
    expect(outside.getAttribute('aria-disabled')).toBe('true')
    expect(outside.hasAttribute('tabindex')).toBe(false)
    await user.click(outside)
    expect(onSelect).not.toHaveBeenCalled()
    await user.click(last)
    expect(onSelect.mock.calls).toEqual([['2027-11-26']])
  })

  it('오늘이 2월 29일이면 다음 해 2월 28일까지다', () => {
    deviceToday(2028, 2, 29)
    open('2029-02-10')
    expect(day('2029년 2월 28일').hasAttribute('aria-disabled')).toBe(false)
    expect(next()).toBeNull()
    expect(days().every((cell) => !cell.hasAttribute('aria-disabled'))).toBe(true)
  })

  it('오늘이 말일이면 다음 해 같은 달의 말일까지다', () => {
    deviceToday(2026, 12, 31)
    open('2027-12-10')
    expect(days().some((cell) => cell.hasAttribute('aria-disabled'))).toBe(false)
    expect(next()).toBeNull()
  })

  it('2000년 1월 1일부터 고를 수 있다', async () => {
    const { user, onSelect } = open('2000-01-15')
    expect(days().some((cell) => cell.hasAttribute('aria-disabled'))).toBe(false)
    await user.click(day('2000년 1월 1일'))
    expect(onSelect.mock.calls).toEqual([['2000-01-01']])
  })
})

describe('고르기', () => {
  it('날짜를 누르면 고른다', async () => {
    const { user, onSelect } = open('2026-11-20')
    await user.click(day('2026년 11월 3일'))
    expect(onSelect.mock.calls).toEqual([['2026-11-03']])
  })

  it('빈칸을 누르면 아무 일도 없다', async () => {
    const { user, onSelect } = open('2026-11-20')
    await user.click(grid().querySelector('tbody tr:last-child td:last-child')!)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it.each(['{Enter}', ' '])('키 "%s"로 초점이 있는 날짜를 고른다', async (key) => {
    const { user, onSelect } = open('2026-11-20')
    await user.keyboard('{ArrowRight}')
    await user.keyboard(key)
    expect(onSelect.mock.calls).toEqual([['2026-11-21']])
  })

  it('칸을 연 Enter를 누르고 있어도 바로 고르지 않는다', () => {
    const { onSelect } = open('2026-11-20')
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true }))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('"오늘"을 누르면 기기의 오늘을 고른다', async () => {
    const { user, onSelect } = open('2026-11-20')
    await user.click(screen.getByRole('button', { name: '오늘' }))
    expect(onSelect.mock.calls).toEqual([['2026-11-26']])
  })

  it('열어 둔 채 자정을 넘기면 "오늘"은 새 날짜를 고른다', async () => {
    deviceToday(2026, 11, 26, 23, 59)
    const { user, onSelect } = open('2026-11-20')
    vi.setSystemTime(new Date(2026, 10, 27, 0, 0))
    await user.click(screen.getByRole('button', { name: '오늘' }))
    expect(onSelect.mock.calls).toEqual([['2026-11-27']])
  })

  it('다시 열면 그때의 오늘을 다시 읽는다', () => {
    deviceToday(2026, 11, 26, 23, 59)
    open('2026-11-20')
    expect(day('2026년 11월 26일').getAttribute('aria-current')).toBe('date')
    cleanup()
    vi.setSystemTime(new Date(2026, 10, 27, 0, 0))
    open('2026-11-20')
    expect(day('2026년 11월 26일').hasAttribute('aria-current')).toBe(false)
    expect(day('2026년 11월 27일').getAttribute('aria-current')).toBe('date')
  })

  it('다시 열면 고를 수 있는 마지막 날도 그때의 오늘로 정한다', () => {
    deviceToday(2026, 11, 27, 0, 0)
    open('2027-11-10')
    expect(day('2027년 11월 27일').hasAttribute('aria-disabled')).toBe(false)
    expect(day('2027년 11월 28일').getAttribute('aria-disabled')).toBe('true')
  })
})

describe('키보드', () => {
  it('열면 고른 날에 초점이 간다', () => {
    open('2026-11-20')
    expect(focused()).toBe('2026년 11월 20일 금요일')
  })

  it.each([
    ['{ArrowLeft}', '2026-11-20', '2026년 11월 19일 목요일'],
    ['{ArrowRight}', '2026-11-20', '2026년 11월 21일 토요일'],
    ['{ArrowUp}', '2026-11-20', '2026년 11월 13일 금요일'],
    ['{ArrowDown}', '2026-11-20', '2026년 11월 27일 금요일'],
    ['{Home}', '2026-11-20', '2026년 11월 15일 일요일'],
    ['{End}', '2026-11-20', '2026년 11월 21일 토요일'],
    ['{PageUp}', '2026-11-20', '2026년 10월 20일 화요일'],
    ['{PageDown}', '2026-11-20', '2026년 12월 20일 일요일'],
    // 달과 해를 넘는 곳
    ['{ArrowLeft}', '2026-11-01', '2026년 10월 31일 토요일'],
    ['{ArrowRight}', '2026-11-30', '2026년 12월 1일 화요일'],
    ['{ArrowUp}', '2026-11-01', '2026년 10월 25일 일요일'],
    ['{ArrowDown}', '2026-11-30', '2026년 12월 7일 월요일'],
    ['{Home}', '2026-12-01', '2026년 11월 29일 일요일'],
    ['{End}', '2026-11-30', '2026년 12월 5일 토요일'],
    ['{ArrowRight}', '2026-12-31', '2027년 1월 1일 금요일'],
    // 없는 날은 그 달의 마지막 날
    ['{PageDown}', '2026-10-31', '2026년 11월 30일 월요일'],
    ['{PageUp}', '2026-03-31', '2026년 2월 28일 토요일'],
    ['{PageDown}', '2024-01-31', '2024년 2월 29일 목요일'],
    // 같은 자리의 칸으로 가도 초점이 새 날짜에 있다
    ['{PageDown}', '2026-02-10', '2026년 3월 10일 화요일'],
    // 범위 밖으로는 나가지 않는다
    ['{ArrowLeft}', '2000-01-01', '2000년 1월 1일 토요일'],
    ['{ArrowUp}', '2000-01-05', '2000년 1월 1일 토요일'],
    ['{Home}', '2000-01-01', '2000년 1월 1일 토요일'],
    ['{PageUp}', '2000-01-31', '2000년 1월 1일 토요일'],
    ['{ArrowRight}', '2027-11-26', '2027년 11월 26일 금요일'],
    ['{ArrowDown}', '2027-11-22', '2027년 11월 26일 금요일'],
    ['{End}', '2027-11-24', '2027년 11월 26일 금요일'],
    ['{PageDown}', '2027-11-01', '2027년 11월 26일 금요일'],
    ['{PageDown}', '2027-10-31', '2027년 11월 26일 금요일'],
  ])('%s: %s에서 "%s"로 옮긴다', async (key, value, expected) => {
    const { user, onSelect } = open(value)
    await user.keyboard(key)
    expect(focused()).toBe(expected)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('달을 넘으면 달 이름도 바뀐다', async () => {
    const { user } = open('2026-11-30')
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('grid', { name: '12월' })).toBeTruthy()
  })

  it('날짜 가운데 Tab으로 들어가는 것은 하나다', async () => {
    const { user } = open('2026-11-20')
    await user.keyboard('{ArrowRight}')
    expect(days().filter((cell) => cell.tabIndex === 0)).toEqual([day('2026년 11월 21일')])
  })

  it('Tab은 이전 달, 다음 달, 날짜, 오늘 순서로 간다', async () => {
    const { user } = open('2026-11-20')
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '오늘' }))
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(day('2026년 11월 20일'))
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(next())
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(previous())
  })

  it.each(['ArrowRight', 'PageDown', 'Home', ' ', 'Enter'])('쓰는 키 "%s"는 화면을 스크롤하지 않는다', (key) => {
    open('2026-11-20')
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    document.activeElement!.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it.each(['Tab', 'Escape', 'a'])('쓰지 않는 키 "%s"는 브라우저에 맡긴다', (key) => {
    open('2026-11-20')
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    document.activeElement!.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it.each(['altKey', 'ctrlKey', 'metaKey'])('%s와 함께 누른 키는 브라우저의 단축키로 남긴다', (modifier) => {
    const { onSelect } = open('2026-11-20')
    for (const key of ['ArrowLeft', 'Enter']) {
      const event = new KeyboardEvent('keydown', { key, [modifier]: true, bubbles: true, cancelable: true })
      document.activeElement!.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    }
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('모양', () => {
  const mark = (name: string) => day(name).firstElementChild!

  it('달 이름과 요일의 글자는 설계서의 토큰이다', () => {
    open('2026-11-20')
    expect(getComputedStyle(screen.getByText('11월')).font).toBe('var(--text-body-strong)')
    expect(getComputedStyle(screen.getByRole('columnheader', { name: '일요일' })).font).toBe('var(--text-caption)')
  })

  it('날짜는 일곱 칸이 같은 폭이고 사이 간격이 없으며 높이는 44px이다', () => {
    open('2026-11-20')
    const table = getComputedStyle(grid())
    expect(table.tableLayout).toBe('fixed')
    expect(table.width).toBe('100%')
    expect(table.borderCollapse).toBe('collapse')
    const cell = getComputedStyle(day('2026년 11월 3일'))
    expect(cell.height).toBe('var(--size-touch)')
    expect(cell.padding).toBe('0px')
  })

  it('빈 줄도 같은 높이를 차지한다', () => {
    open('2026-11-20')
    expect(getComputedStyle(grid().querySelector('tbody tr:last-child td')!).height).toBe('var(--size-touch)')
  })

  it('숫자는 폭이 같은 본문 글자다', () => {
    open('2026-11-20')
    expect(getComputedStyle(mark('2026년 11월 3일')).font).toBe('var(--text-body)')
    expect(mark('2026년 11월 3일').classList.contains('tabular-nums')).toBe(true)
  })

  it('오늘과 고른 날의 표시는 칸 폭과 관계없이 44x44px, 모서리 10px로 가운데에 있다', () => {
    open('2026-11-20')
    for (const name of ['2026년 11월 20일', '2026년 11월 26일']) {
      const style = getComputedStyle(mark(name))
      expect(style.width).toBe('min(100%, var(--size-touch))')
      expect(style.height).toBe('var(--size-touch)')
      expect(style.borderRadius).toBe('var(--radius-10)')
      expect(style.marginInline).toBe('auto')
    }
  })

  it('고른 날은 강조색 바탕이고 오늘은 강조색 1px 테두리다', () => {
    open('2026-11-20')
    const selected = getComputedStyle(mark('2026년 11월 20일'))
    expect(selected.backgroundColor).toBe('var(--color-accent)')
    expect(selected.color).toBe('var(--color-on-accent)')
    expect(rule(".day[aria-current='date'] .mark")).toContain('border: 1px solid var(--color-accent)')
  })

  it('범위 밖 날짜는 보조 글자색이다', () => {
    open('2027-11-10')
    expect(getComputedStyle(day('2027년 11월 27일')).color).toBe('var(--color-text-secondary)')
  })

  it('초점은 칸 안쪽에 그린다. 고른 날은 강조색 위에서 보이게 안으로 더 띄운다', () => {
    expect(rule('.day:focus-visible .mark')).toContain(
      'outline: var(--focus-ring-width) solid var(--color-accent); outline-offset: calc(-1 * var(--focus-ring-width))',
    )
    expect(rule(".day[aria-selected='true']:focus-visible .mark")).toContain(
      'outline-color: var(--color-on-accent); outline-offset: calc(-2 * var(--focus-ring-width))',
    )
  })

  it('달력의 좌우 안쪽은 4px이고 "오늘"의 글자는 16px 선에서 시작한다', () => {
    open('2026-11-20')
    const button = screen.getByRole('button', { name: '오늘' })
    expect(getComputedStyle(grid().parentElement!).paddingInline).toBe('var(--space-4)')
    expect(getComputedStyle(button.parentElement!).paddingInlineStart).toBe('var(--space-4)')
    expect(getComputedStyle(button).paddingInline).toBe('var(--space-8)')
    // 4px(달력) + 4px(감싼 칸) + 8px(글자 버튼) = 16px
  })

  it('달력 아래쪽은 요일 줄, 날짜, "오늘" 순서다', () => {
    open('2026-11-20')
    const order = [screen.getByText('11월'), screen.getAllByRole('columnheader')[0], days()[0], screen.getByRole('button', { name: '오늘' })]
    const all = [...document.querySelectorAll('*')]
    const positions = order.map((element) => all.indexOf(element))
    expect(positions).toEqual(positions.toSorted((a, b) => a - b))
    expect(within(grid()).queryByRole('button')).toBeNull()
  })
})
