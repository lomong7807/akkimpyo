import { screen, waitFor, within } from '@testing-library/react'
import type { SetupServer } from 'msw/node'
import { expect } from 'vitest'
import { setDeviceClock } from './clock'
import { installIntersectionObserver } from './intersection'
import { startTransactionDetail } from './transactionDetail'
import { expenseOf, incomeOf, startTransactionList, transferOf } from './transactionList'
import { amount, id, openApp, startServer, type Opened } from './transactionScreen'

/* 거래 수정(D-04 수정 모드) 화면 테스트가 함께 쓰는 가짜 서버, 거래, 찾기, 여는 길 */

/**
 * 기기의 지금은 서울의 2026-11-26 12:30이다(시간대마다 보는 테스트는 setDeviceClock으로 다시 정한다). 확인 창을 여닫을 때
 * 누름을 막는 300ms는 공용 시계(testClock)가 앞당긴다.
 */
export function deviceNow() {
  setDeviceClock('2026-11-26T12:30:00+09:00')
}

/** 로그인한 user-1의 장부에 계좌, 카테고리, 거래 만들기, 목록, 상세, 수정이 되는 가짜 서버 */
export function startEditServer(server: SetupServer) {
  const started = startServer(server)
  const list = startTransactionList(server, started.backend)
  const detail = startTransactionDetail(server, started.backend)
  detail.uncategorized = { EXPENSE: id.expenseNone, INCOME: id.incomeNone }
  // 내역은 목록 끝을 지켜본다
  installIntersectionObserver()
  /** 서버와 내역(11월)에 넣는다. 같은 객체라 수정이 목록에도 보인다. */
  function put(...items: Item[]) {
    detail.put(...items)
    list.months.set('2026-11', items)
  }
  return { ...started, list, detail, put }
}

/** 디자인 시안의 지출. 시각과 메모가 있다. */
export function lunch(changes: object = {}) {
  return expenseOf(
    {
      occurredOn: '2026-11-25',
      occurredTime: '13:05',
      accountId: id.wallet,
      categoryId: id.dining,
      amount: 25000,
      payee: '김밥천국',
      memo: '팀 점심\n영수증은 사진첩에',
    },
    changes,
  )
}

/** 시각, 가맹점, 메모가 없고 미분류인 수입 */
export function salary(changes: object = {}) {
  return incomeOf(
    { occurredOn: '2026-11-25', accountId: id.salary, categoryId: id.incomeNone, amount: 3200000 },
    changes,
  )
}

/** 급여통장에서 비상금으로 보낸 이체 */
export function saving(changes: object = {}) {
  return transferOf(
    { occurredOn: '2026-11-24', occurredTime: '09:00', fromAccountId: id.salary, toAccountId: id.saving, amount: 500000 },
    changes,
  )
}

export type Item = ReturnType<typeof lunch>

export const editHeading = () => screen.queryByRole('heading', { level: 1, name: '거래 수정' })
export const detailPath = (item: Item) => `/transactions/${String(item.id)}`
export const editPath = (item: Item) => `${detailPath(item)}/edit`
export const pathOf = ({ router }: Opened) => router.state.location.pathname
export const toastText = () => document.querySelector('[class*="region"]')?.textContent ?? ''
/** 상세의 상단 바에 있는 "수정". 넓은 화면에서는 내역 오른쪽 칸(거래 상세 영역)의 머리에 있다(#244) */
export const editLink = () =>
  within(screen.queryByRole('region', { name: '거래 상세' }) ?? screen.getByRole('banner')).queryByRole('link', {
    name: '수정',
  })
/** 상세의 항목 줄 [이름, 값] */
export const detailItems = () =>
  [...screen.getByRole('main').querySelectorAll('dl > div')].map((row) => [
    row.querySelector('dt')!.textContent,
    row.querySelector('dd')!.textContent,
  ])

/** 내역에서 그 거래의 줄 */
export async function rowOf(item: Item): Promise<HTMLAnchorElement> {
  return waitFor(() => {
    const row = screen.getByRole('main').querySelector<HTMLAnchorElement>(`a[href="${detailPath(item)}"]`)
    if (!row) throw new Error('아직 줄이 없다')
    return row
  })
}

/** 수정 화면이 열리고 칸이 채워질 때까지 기다린다. */
export async function untilEditForm() {
  await waitFor(() => expect(editHeading()).toBeTruthy())
  await waitFor(() => expect(amount().value).not.toBe(''))
}

/** 상세가 그려질 때까지 기다린다. */
export async function untilDetail() {
  // 넓은 화면에서는 내역 오른쪽 칸의 화면이라 제목이 h2다(#244)
  await waitFor(() => expect(screen.getByRole('heading', { name: '거래 상세' })).toBeTruthy())
  await waitFor(() => expect(within(screen.getByRole('main')).queryByText('작성자')).toBeTruthy())
}

/** 수정 주소를 바로 연다(앞 화면이 없다). */
export async function openEdit(item: Item) {
  const opened = await openApp(editPath(item))
  await untilEditForm()
  return opened
}

/** 내역(11월) → 상세 → "수정"으로 연다. 닫거나 저장하면 앞 화면인 상세로 돌아간다. */
export async function openFromDetail(item: Item) {
  const opened = await openApp('/transactions?month=2026-11')
  await opened.user.click(await rowOf(item))
  await untilDetail()
  await opened.user.click(editLink()!)
  await untilEditForm()
  return opened
}
