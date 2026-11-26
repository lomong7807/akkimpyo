import { act, cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { untilOpened } from './support/dialog'
import {
  deviceNow,
  detailPath,
  editLink,
  lunch,
  pathOf,
  rowOf,
  startEditServer,
  toastText,
  untilDetail,
  untilEditForm,
  type Item,
} from './support/transactionEdit'
import {
  amount,
  closeButton,
  discardQuestion,
  openApp,
  resetGlobals,
  saveAmount,
  saveButton,
  untilDefaultAccount,
  type Opened,
  type User,
} from './support/transactionScreen'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import type { Transactions } from './support/transactions'
import { resetViewport } from './support/viewport'

/*
 * 저장에 성공해 돌아온 화면은 맨 위에서 시작하고(#245, designer 결정 2026-11-26), 닫기·취소·브라우저 뒤로·Esc로 돌아온 화면은
 * 앞서 보던 위치를 지킨다(00-common 4.5). jsdom은 스크롤하지 않으므로 창의 스크롤을 흉내 내 어느 이동이 어디로 가는지 본다.
 * 실제 스크롤은 Chromium에서 긴 홈과 내역으로 잰다(PR 본문).
 */

/** 앞 화면에서 보던 위치 */
const READ_DOWN = 395

const server = startMockServer()
let put: (...items: Item[]) => void
let transactions: Transactions
/** 창이 스크롤된 위치. scrollTo가 옮기고 scrollY가 돌려준다 */
let scrolled = 0

beforeEach(() => {
  deviceNow()
  scrolled = 0
  vi.stubGlobal(
    'scrollTo',
    vi.fn((_x: number, y: number) => {
      scrolled = y
    }),
  )
  vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scrolled)
  ;({ put, transactions } = startEditServer(server))
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  resetViewport()
  resetGlobals()
})

/** 내역(11월)을 열고 아래로 내려 읽는다. */
async function readListDown(): Promise<Opened & { item: Item }> {
  const item = lunch()
  put(item)
  const opened = await openApp('/transactions?month=2026-11')
  await rowOf(item)
  window.scrollTo(0, READ_DOWN)
  return { ...opened, item }
}

/** 지금 화면에서 거래 입력을 연다(빠른 입력, 사이드바의 "거래 입력"과 같은 쌓기). */
async function openNew({ router }: Opened) {
  await act(() => router.navigate('/transactions/new'))
  await untilDefaultAccount()
}

/** 내역 → 상세로 가서 아래로 내려 읽고 "수정"을 연다. */
async function openEditFromDetail(): Promise<Opened & { item: Item }> {
  const opened = await readListDown()
  await opened.user.click(await rowOf(opened.item))
  await untilDetail()
  window.scrollTo(0, READ_DOWN)
  await opened.user.click(editLink()!)
  await untilEditForm()
  return opened
}

/** 내역이 다시 그려질 때까지 기다린다. 라우터의 주소는 화면을 그리기 전에 바뀌므로 그 줄이 그려진 것으로 본다. */
async function untilList(opened: Opened & { item: Item }) {
  await rowOf(opened.item)
  expect(pathOf(opened)).toBe('/transactions')
}

async function changeAmount(user: User) {
  await user.clear(amount())
  await user.keyboard('30000')
}

describe('거래 입력', () => {
  it('저장에 성공해 돌아온 내역은 맨 위에서 시작하고 토스트가 뜬다', async () => {
    const opened = await readListDown()
    await openNew(opened)
    expect(scrolled).toBe(0)
    await saveAmount(opened.user)
    await untilList(opened)
    await waitFor(() => expect(toastText()).toBe('저장했어요'))
    expect(scrolled).toBe(0)
  })

  it.each<[string, (opened: Opened) => Promise<void>]>([
    ['닫기', ({ user }) => user.click(closeButton())],
    ['Esc', ({ user }) => user.keyboard('{Escape}')],
    ['브라우저 뒤로', () => act(() => window.history.back())],
    [
      '바꾼 뒤 닫고 "버리기"',
      async ({ user }) => {
        await saveAmountWithoutSaving(user)
        await user.click(closeButton())
        await untilOpened()
        expect(discardQuestion()).toBeTruthy()
        await user.click(screen.getByRole('button', { name: '버리기' }))
      },
    ],
  ])('%s로 돌아온 내역은 앞서 보던 위치를 지킨다', async (_, leave) => {
    const opened = await readListDown()
    await openNew(opened)
    await leave(opened)
    await untilList(opened)
    expect(scrolled).toBe(READ_DOWN)
  })

  it('맨 위로 가는 것은 저장 뒤 돌아온 한 번뿐이다. 다시 열었다 닫으면 그때 보던 위치로 돌아온다', async () => {
    const opened = await readListDown()
    await openNew(opened)
    await saveAmount(opened.user)
    await untilList(opened)
    expect(scrolled).toBe(0)

    window.scrollTo(0, 200)
    await openNew(opened)
    await opened.user.click(closeButton())
    await untilList(opened)
    expect(scrolled).toBe(200)
  })

  it('저장에 실패한 뒤 닫으면 앞서 보던 위치로 돌아온다', async () => {
    const opened = await readListDown()
    await openNew(opened)
    transactions.response = () => problem(500, 'INTERNAL_ERROR')
    await saveAmount(opened.user)
    await screen.findByRole('button', { name: '다시 시도' })
    await opened.user.click(closeButton())
    await untilOpened()
    await opened.user.click(screen.getByRole('button', { name: '버리기' }))
    await untilList(opened)
    expect(scrolled).toBe(READ_DOWN)
  })
})

describe('거래 수정', () => {
  it('저장에 성공해 돌아온 상세는 맨 위에서 시작한다', async () => {
    const opened = await openEditFromDetail()
    await changeAmount(opened.user)
    await opened.user.click(saveButton())
    await untilDetail()
    await waitFor(() => expect(toastText()).toBe('저장했어요'))
    expect(pathOf(opened)).toBe(detailPath(opened.item))
    expect(scrolled).toBe(0)
  })

  it('닫고 돌아온 상세는 앞서 보던 위치를 지킨다', async () => {
    const opened = await openEditFromDetail()
    await opened.user.click(closeButton())
    await untilDetail()
    expect(scrolled).toBe(READ_DOWN)
  })

  it('바꾼 것 없이 저장을 누르면 닫기와 같아 앞서 보던 위치를 지킨다', async () => {
    const opened = await openEditFromDetail()
    await opened.user.click(saveButton())
    await untilDetail()
    expect(toastText()).toBe('')
    expect(scrolled).toBe(READ_DOWN)
  })

  it('다른 기기가 먼저 고쳐 "최신 내용 보기"로 돌아온 상세는 앞서 보던 위치를 지킨다', async () => {
    const opened = await openEditFromDetail()
    Object.assign(opened.item, { amount: 40000, version: 2 })
    await changeAmount(opened.user)
    await opened.user.click(saveButton())
    // 수정 충돌 안내(N-04)의 "최신 내용 보기"
    const latest = await screen.findByRole('button', { name: '최신 내용 보기' })
    await untilOpened()
    await opened.user.click(latest)
    await untilDetail()
    expect(scrolled).toBe(READ_DOWN)
  })
})

describe('계좌 추가', () => {
  async function openFromAccounts() {
    const opened = await openApp('/accounts')
    await screen.findByText('자산 합계')
    window.scrollTo(0, READ_DOWN)
    await opened.user.click(screen.getByRole('link', { name: '추가' }))
    await screen.findByRole('heading', { level: 1, name: '계좌 추가' })
    // 화면 코드를 받는 동안의 틀에도 같은 제목이 있다(#251)
    await screen.findByLabelText('이름')
    return opened
  }

  it('저장에 성공해 돌아온 계좌 목록은 맨 위에서 시작한다', async () => {
    const opened = await openFromAccounts()
    await opened.user.click(screen.getByLabelText('이름'))
    await opened.user.paste('여행통장')
    await opened.user.click(screen.getByLabelText('시작 잔액'))
    await opened.user.keyboard('350000')
    await opened.user.click(saveButton())
    await screen.findByText('여행통장')
    expect(pathOf(opened)).toBe('/accounts')
    expect(scrolled).toBe(0)
  })

  it('닫고 돌아온 계좌 목록은 앞서 보던 위치를 지킨다', async () => {
    const opened = await openFromAccounts()
    await opened.user.click(closeButton())
    await screen.findByText('자산 합계')
    expect(pathOf(opened)).toBe('/accounts')
    expect(scrolled).toBe(READ_DOWN)
  })
})

/** 금액만 넣고 저장하지 않는다. */
async function saveAmountWithoutSaving(user: User) {
  await user.click(amount())
  await user.keyboard('12000')
}
