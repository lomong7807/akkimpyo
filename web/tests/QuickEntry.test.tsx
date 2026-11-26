import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { holdKeyboard } from '../src/components/keyboardBridge'
import { canEdit } from '../src/features/me/me'
import { meOf, type Backend } from './support/backend'
import { readCssRule } from './support/cssRule'
import { setDeviceClock } from './support/clock'
import { startGuardClock } from './support/guardClock'
import { startMockServer } from './support/mockServer'
import { readWebFile } from './support/webFile'
import {
  amount,
  openApp,
  path,
  resetGlobals,
  saveButton,
  startServer,
  typeRadio,
  untilDefaultAccount,
  type Opened,
} from './support/transactionScreen'
import type { Transactions } from './support/transactions'
import { resetViewport, setViewportWidth } from './support/viewport'

const server = startMockServer()
let backend: Backend
let transactions: Transactions

beforeEach(() => {
  setDeviceClock('2026-11-26T12:30:00+09:00')
  startGuardClock()
  vi.stubGlobal('scrollTo', vi.fn())
  ;({ backend, transactions } = startServer(server))
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  resetViewport()
  resetGlobals()
})

const tabBar = () => screen.getByRole('navigation', { name: '주 메뉴' })
const quickEntry = () => within(tabBar()).getByRole('link', { name: '거래 입력' })
const sidebar = () => document.querySelector<HTMLElement>('[class*="sidebar"]')!
const sidebarButton = () => within(sidebar()).getByRole('link', { name: '거래 입력' })
const bridge = () => document.querySelector('[data-keyboard-bridge]')
const styleOf = (element: Element) => getComputedStyle(element)

async function openAt(address: string, width = 390) {
  const opened = await openApp(address)
  await screen.findByRole('navigation', { name: '주 메뉴' })
  setViewportWidth(width)
  return opened
}

async function untilForm(opened: Opened) {
  await untilDefaultAccount()
  expect(path(opened)).toBe('/transactions/new')
}

describe('하단 탭의 거래 입력 칸(휴대폰 배치)', () => {
  it('1A는 홈, 내역, 거래 입력, 더보기 네 칸이 같은 폭으로 놓인다(거래 입력은 칸 순서의 자리)', async () => {
    await openAt('/more')
    const cells = within(tabBar()).getAllByRole('listitem')
    expect(cells.map((cell) => cell.textContent)).toEqual(['홈', '내역', '', '더보기'])
    expect(cells[2].contains(quickEntry())).toBe(true)
    expect(styleOf(within(tabBar()).getByRole('list')).gridAutoColumns).toBe('minmax(0, 1fr)')
  })

  it('44px 강조색 바탕, 모서리 10px, 강조색 위 글자색의 Plus 24px이고 그림자와 글자가 없으며 칸 가운데에 있다', async () => {
    await openAt('/more')
    const style = styleOf(quickEntry())
    const rule = readCssRule('src/app/TabBar.module.css', '.quickEntry')
    // 정사각형이고 크기는 토큰 값(44px)과 칸 폭 중 작은 것이다. 칸은 자기 폭을 재는 컨테이너다(아래 테스트)
    expect(rule).toContain('width: min(var(--size-quick-entry), 100cqi);')
    expect(rule).toContain('height: min(var(--size-quick-entry), 100cqi);')
    expect(style.backgroundColor).toBe('var(--color-accent)')
    expect(style.color).toBe('var(--color-on-accent)')
    expect(style.borderRadius).toBe('var(--radius-10)')
    expect(readCssRule('src/app/TabBar.module.css', '.quickEntry')).not.toContain('shadow')
    expect(readCssRule('src/app/TabBar.module.css', '.quickEntry')).toContain('place-self: center')
    expect(quickEntry().textContent).toBe('')
    const icon = quickEntry().querySelector('svg')!
    expect(styleOf(icon).width).toBe('var(--size-icon-24)')
    expect(icon.getAttribute('aria-hidden')).toBe('true')
  })

  // designer 검토(#90): 320px 글자 200%에서 버튼(88px)이 칸(64px)을 넘어 옆 칸의 아이콘을 가렸다
  it('버튼은 칸 폭을 넘지 않는다: 칸이 토큰 값보다 좁으면 칸 폭의 정사각형이고 아이콘은 그대로 가운데다', async () => {
    await openAt('/more')
    const cell = quickEntry().parentElement!
    expect(cell.tagName).toBe('LI')
    expect(readCssRule('src/app/TabBar.module.css', '.tabs > li')).toContain('container-type: inline-size;')
    const rule = readCssRule('src/app/TabBar.module.css', '.quickEntry')
    expect(rule).toContain('justify-content: center;')
    expect(rule).toContain('align-items: center;')
    expect(rule).not.toMatch(/padding/)
    expect(styleOf(quickEntry().querySelector('svg')!).width).toBe('var(--size-icon-24)')
  })

  it('접근성 이름은 "거래 입력"이고 지금 화면 표시를 받지 않는다', async () => {
    await openAt('/more')
    expect(quickEntry().getAttribute('aria-current')).toBeNull()
    expect(within(tabBar()).getByRole('link', { name: '더보기' }).getAttribute('aria-current')).toBe('page')
  })

  it.each(['/more', '/accounts', '/categories', '/없는-주소'])('하단 탭이 보이는 %s에 있다', async (address) => {
    await openAt(address)
    expect(quickEntry()).toBeTruthy()
  })

  it.each([
    ['계좌 추가', '/accounts/new'],
    ['거래 입력', '/transactions/new'],
  ])('하단 탭이 없는 전체 화면 입력(%s)에는 없다', async (_, address) => {
    await openApp(address)
    await screen.findByRole('heading', { level: 1 })
    setViewportWidth(390)
    expect(screen.queryByRole('navigation', { name: '주 메뉴' })).toBeNull()
    expect(screen.queryByRole('link', { name: '거래 입력' })).toBeNull()
  })

  it('로그인 전 화면에는 없다', async () => {
    backend.cookieUser = undefined
    await openApp('/login')
    await screen.findByRole('heading', { level: 1, name: '로그인' })
    expect(screen.queryByRole('link', { name: '거래 입력', hidden: true })).toBeNull()
  })

  it('누르면 지출 유형으로 거래 입력이 열리고 금액에 초점이 있다', async () => {
    const opened = await openAt('/more')
    await opened.user.click(quickEntry())
    await untilForm(opened)
    expect(typeRadio('지출').getAttribute('aria-checked')).toBe('true')
    await waitFor(() => expect(document.activeElement).toBe(amount()))
  })

  it('닫으면 누른 화면으로 돌아간다', async () => {
    const opened = await openAt('/accounts')
    await opened.user.click(quickEntry())
    await untilForm(opened)
    await opened.user.click(screen.getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(path(opened)).toBe('/accounts'))
  })

  it('저장하면 누른 화면으로 돌아가 토스트가 보인다', async () => {
    const opened = await openAt('/categories')
    await opened.user.click(quickEntry())
    await untilForm(opened)
    await opened.user.keyboard('12000')
    await opened.user.click(saveButton())
    await waitFor(() => expect(path(opened)).toBe('/categories'))
    expect(await screen.findByText('저장했어요')).toBeTruthy()
    expect(transactions.sent).toHaveLength(1)
  })

  it('빠르게 두 번 눌러도 거래 입력은 하나만 열린다', async () => {
    const opened = await openAt('/more')
    const link = quickEntry()
    fireEvent.click(link)
    fireEvent.click(link)
    await untilForm(opened)
    await act(() => opened.router.navigate(-1))
    await waitFor(() => expect(path(opened)).toBe('/more'))
  })

  it('누르는 처리 안에서 보이지 않는 숫자 칸에 먼저 초점을 주고, 금액 칸으로 옮기면 걷는다', async () => {
    const opened = await openAt('/more')
    const focused: Element[] = []
    const record = (event: FocusEvent) => void focused.push(event.target as Element)
    document.addEventListener('focusin', record)
    onTestFinished(() => document.removeEventListener('focusin', record))
    fireEvent.click(quickEntry())
    // 누른 처리가 끝나기 전에 이미 숫자 칸에 초점이 있다
    const first = focused[0] as HTMLInputElement
    expect(first.dataset.keyboardBridge).toBe('')
    expect(first.inputMode).toBe('numeric')
    await untilForm(opened)
    await waitFor(() => expect(document.activeElement).toBe(amount()))
    expect(focused.at(-1)).toBe(amount())
    expect(bridge()).toBeNull()
  })
})

describe('사이드바의 "거래 입력"(넓은 화면)', () => {
  it('장부 이름 아래 전체 폭의 주 버튼(48px)이고 Plus 20px과 "거래 입력"이다', async () => {
    await openAt('/more', 1280)
    const button = sidebarButton()
    const all = [...sidebar().querySelectorAll('*')]
    expect(all.indexOf(within(sidebar()).getByText('user-1의 장부'))).toBeLessThan(all.indexOf(button))
    expect(all.indexOf(button)).toBeLessThan(all.indexOf(sidebar().querySelector('nav')!))
    expect(button.className).toContain('primary')
    expect(styleOf(button).minHeight).toBe('var(--size-button)')
    expect(styleOf(button.parentElement!).display).toBe('grid')
    expect(styleOf(button.querySelector('svg')!).width).toBe('var(--size-icon-20)')
    expect(button.textContent).toBe('거래 입력')
    expect(button.getAttribute('aria-current')).toBeNull()
  })

  it('요소 사이는 16px이다', () => {
    expect(readWebFile('src/app/Sidebar.module.css').split('@media (width >= 1024px)')[1]).toContain('gap: var(--space-16)')
  })

  it('누르면 거래 입력이 내용 영역에 열리고 사이드바는 그대로 있다', async () => {
    const opened = await openAt('/more', 1280)
    await opened.user.click(sidebarButton())
    await untilForm(opened)
    expect(sidebarButton()).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(amount()))
  })
})

describe('권한', () => {
  it.each([
    ['소유자', 'OWNER', true],
    ['편집 가능', 'MEMBER', true],
    ['보기 전용', 'VIEWER', false],
    ['모르는 권한', 'GUEST', false],
    ['빈 글자', '', false],
  ])('%s(%s)는 거래를 쓸 수 있다: %s', (_, role, expected) => {
    expect(canEdit({ id: 'ledger', name: '내 가계부', role })).toBe(expected)
  })

  it('보기 전용에게는 하단 탭의 칸도 사이드바 버튼도 없다', async () => {
    backend.meResponse = () =>
      HttpResponse.json({ ...meOf('user-1'), ledgers: [{ ...meOf('user-1').ledgers[0], role: 'VIEWER' }] })
    await openAt('/more')
    expect(within(tabBar()).getAllByRole('listitem').map((cell) => cell.textContent)).toEqual(['홈', '내역', '더보기'])
    setViewportWidth(1280)
    expect(screen.queryByRole('link', { name: '거래 입력', hidden: true })).toBeNull()
  })
})

describe('키보드 올려 두기', () => {
  it('보이지 않는 숫자 칸을 붙여 초점을 주고, 초점이 떠나면 걷는다', () => {
    render(<button type="button">다른 곳</button>)
    holdKeyboard(new MouseEvent('click') as never)
    const input = bridge() as HTMLInputElement
    expect(document.activeElement).toBe(input)
    expect(input.inputMode).toBe('numeric')
    expect(input.tabIndex).toBe(-1)
    expect(input.getAttribute('aria-hidden')).toBe('true')
    // 브라우저가 이 칸에 저장된 값이나 자동 완성을 띄우지 않게 한다
    expect(input.getAttribute('autocomplete')).toBe('off')
    const rule = readCssRule('src/components/keyboardBridge.module.css', '.bridge')
    expect(rule).toContain('opacity: 0')
    expect(rule).toContain('pointer-events: none')
    expect(rule).toContain('font: var(--text-body)')
    screen.getByRole('button', { name: '다른 곳' }).focus()
    expect(bridge()).toBeNull()
  })

  it('아무도 초점을 가져가지 않으면 잠시 뒤 걷는다', () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    holdKeyboard(new MouseEvent('click') as never)
    expect(bridge()).toBeTruthy()
    vi.advanceTimersByTime(1000)
    expect(bridge()).toBeNull()
  })

  it.each(['metaKey', 'ctrlKey', 'shiftKey', 'altKey'])('새 창으로 여는 누르기(%s)에는 하지 않는다', (modifier) => {
    holdKeyboard(new MouseEvent('click', { [modifier]: true }) as never)
    expect(bridge()).toBeNull()
  })
})
