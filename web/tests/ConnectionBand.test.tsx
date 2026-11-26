import { act, cleanup, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Backend } from './support/backend'
import { setDeviceClock } from './support/clock'
import { goOffline, goOnline } from './support/connection'
import { passTime, startGuardClock } from './support/guardClock'
import { installIntersectionObserver } from './support/intersection'
import { startMockServer } from './support/mockServer'
import { expenseOf, startTransactionList, type TransactionList } from './support/transactionList'
import { id, openApp, resetGlobals, settle, startServer, untilDefaultAccount } from './support/transactionScreen'
import { resetViewport, setViewportWidth } from './support/viewport'
import { readCssRule } from './support/cssRule'
import { toastRegion } from './support/toast'
import { readWebFile } from './support/webFile'

/*
 * 연결 없음 띠(00-common 6.1 (6) [판단 56], F-908, N-03 (4), #235). 연결 없음이 2초 넘게 이어지면 띄우고 요청이 연결 문제로
 * 실패하면 바로 띄운다. 연결이 돌아오면 바로 지우고 화면 데이터를 다시 받으며, 화면 읽기 프로그램에 "다시 연결됐어요"를 알린다.
 */

const server = startMockServer()
let backend: Backend
let list: TransactionList

const BAND = '연결이 없어요. 새 거래 입력만 돼요.'
const CSS = 'src/features/connection/ConnectionBand.module.css'

beforeEach(() => {
  setDeviceClock('2026-11-26T12:30:00+09:00')
  startGuardClock()
  vi.stubGlobal('scrollTo', vi.fn())
  ;({ backend } = startServer(server))
  list = startTransactionList(server, backend)
  installIntersectionObserver()
  server.use(http.head('/api/v1/', () => new HttpResponse(null, { status: 404, headers: { 'X-Request-Id': 'req-probe' } })))
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  resetViewport()
  resetGlobals()
})

const band = () => screen.queryByText(BAND)
const bandRegion = () => document.querySelector<HTMLElement>('[class*="_connectionBand_"]')!

async function openHome() {
  const opened = await openApp('/home')
  await screen.findByRole('heading', { level: 1, name: '홈' })
  await settle()
  return opened
}

describe('보이는 때', () => {
  // 2초의 경계는 bandState.test.ts가 가짜 시계로 잰다. 이 파일의 공용 시계는 실제로 흐른 시간도 보태 경계를 재지 않는다
  it('브라우저 신호로 끊기면 바로 띄우지 않고 2초가 넘으면 띄운다', async () => {
    await openHome()
    act(() => goOffline())
    expect(band()).toBeNull()
    await passTime(2_000)
    expect(band()).not.toBeNull()
  })

  it('2초 안에 돌아오면 띠를 띄우지 않고 알리지도 않는다(깜빡이지 않게)', async () => {
    await openHome()
    act(() => goOffline())
    act(() => goOnline())
    await passTime(2_000)
    expect(band()).toBeNull()
    expect(bandRegion().textContent).toBe('')
  })

  it('요청이 연결 문제로 실패하면 기다리지 않고 바로 띄운다', async () => {
    list.response = () => HttpResponse.error()
    await openApp('/transactions?month=2026-11')
    await screen.findByText('불러오지 못했어요.')
    expect(band()).not.toBeNull()
  })

  it('신호로 끊겨 2초를 기다리는 동안 요청이 연결 문제로 실패하면 바로 띄운다', async () => {
    const { router } = await openHome()
    act(() => goOffline())
    list.response = () => HttpResponse.error()
    await act(() => router.navigate('/transactions?month=2026-11'))
    await screen.findByText('불러오지 못했어요.')
    expect(band()).not.toBeNull()
  })

  it('화면을 옮겨도 2초를 처음부터 다시 세지 않는다', async () => {
    const { router } = await openHome()
    act(() => goOffline())
    await passTime(1_500)
    await act(() => router.navigate('/more'))
    await screen.findByRole('link', { name: '계좌' })
    await passTime(500)
    expect(band()).not.toBeNull()
  })
})

describe('연결이 돌아오면', () => {
  it('띠를 바로 지우고 화면 읽기 프로그램에만 "다시 연결됐어요"를 알린다(눈에 보이는 토스트 없음)', async () => {
    await openHome()
    act(() => goOffline())
    await passTime(2_000)
    expect(bandRegion().textContent).toBe(BAND)
    act(() => goOnline())
    expect(band()).toBeNull()
    const said = within(bandRegion()).getByText('다시 연결됐어요')
    expect(said.className).toMatch(/_spoken_/)
    expect(readWebFile(CSS)).toMatch(/\.spoken \{[^}]*clip-path: inset\(50%\)/)
    // 토스트 자리(ToastProvider)는 비어 있다
    expect(toastRegion().textContent).toBe('')
  })

  it('요청 실패로 없음이 된 뒤 확인 요청으로 돌아오면 지금 화면의 데이터를 다시 받는다', async () => {
    list.months.set('2026-11', [expenseOf({ occurredOn: '2026-11-26', accountId: id.salary, amount: 3000, payee: '돌아온 뒤' })])
    list.response = () => HttpResponse.error()
    await openApp('/transactions?month=2026-11')
    await screen.findByText('불러오지 못했어요.')
    list.response = undefined
    // 확인 요청은 5초 뒤에 간다(api/connection)
    await passTime(5_000)
    expect(await screen.findByText('돌아온 뒤')).toBeTruthy()
    expect(band()).toBeNull()
  })
})

describe('자리와 모양', () => {
  it('휴대폰 배치: 주 화면은 상단 바 바로 아래, 화면 전체 폭이다', async () => {
    await openHome()
    act(() => goOffline())
    await passTime(2_000)
    expect(bandRegion().previousElementSibling?.tagName).toBe('HEADER')
    expect(bandRegion().previousElementSibling?.className).toMatch(/_topBar_/)
    expect(bandRegion().className).not.toMatch(/contentWidth/)
  })

  it('휴대폰 배치: 하위 화면도 상단 바 바로 아래다', async () => {
    const { router } = await openHome()
    act(() => goOffline())
    await passTime(2_000)
    await act(() => router.navigate('/accounts'))
    await screen.findByRole('heading', { level: 1, name: '계좌' })
    expect(band()).not.toBeNull()
    expect(bandRegion().previousElementSibling?.tagName).toBe('HEADER')
  })

  it('전체 화면 입력은 머리 바로 아래다', async () => {
    const { router } = await openHome()
    act(() => goOffline())
    await passTime(2_000)
    await act(() => router.navigate('/transactions/new'))
    await untilDefaultAccount()
    expect(band()).not.toBeNull()
    const head = bandRegion().previousElementSibling!
    expect(within(head as HTMLElement).getByRole('heading', { level: 1, name: '거래 입력' })).toBeTruthy()
  })

  it('넓은 화면은 내용 영역 맨 위다(하위 화면의 화면 이름 줄보다 위)', async () => {
    const { router } = await openHome()
    act(() => goOffline())
    await passTime(2_000)
    await act(() => router.navigate('/accounts'))
    await screen.findByRole('heading', { level: 1, name: '계좌' })
    setViewportWidth(1280)
    expect(getComputedStyle(bandRegion()).order).toBe('-1')
  })

  it('모양: color-border 바탕, color-text 글자(text-secondary 크기), WifiSlash 20px, 높이 40px 이상, 모서리 0, 누를 수 없다', async () => {
    await openHome()
    act(() => goOffline())
    await passTime(2_000)
    const shown = band()!.closest('p')!
    const style = getComputedStyle(shown)
    expect(style.backgroundColor).toBe('var(--color-border)')
    expect(style.color).toBe('var(--color-text)')
    expect(style.font).toBe('var(--text-secondary)')
    expect(style.minHeight).toBe('var(--space-40)')
    expect(style.borderRadius).toBe('')
    const icon = shown.querySelector('svg')!
    expect(icon.getAttribute('aria-hidden')).toBe('true')
    expect(icon.getAttribute('class')).toMatch(/size20/)
    expect(within(bandRegion()).queryByRole('button')).toBeNull()
    expect(within(bandRegion()).queryByRole('link')).toBeNull()
    // 내용을 덮지 않고 아래로 민다. 움직임이 없다
    expect(readCssRule(CSS, '.connectionBand')).not.toMatch(/position: (absolute|fixed)/)
    expect(readCssRule(CSS, '.bar')).not.toMatch(/position/)
    expect(readWebFile(CSS)).not.toMatch(/animation|transition/)
  })
})
