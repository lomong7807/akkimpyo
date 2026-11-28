import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { accountOf } from './support/accounts'
import { untilOpened } from './support/dialog'
import { startMockServer } from './support/mockServer'
import { toastRegion } from './support/toast'
import {
  detailPath,
  deviceNow,
  editLink,
  editPath,
  lunch,
  rowOf,
  saving,
  startEditServer,
  untilDetail,
  type Item,
} from './support/transactionEdit'
import { savedOf } from './support/transactions'
import {
  accountField,
  amount,
  discardQuestion,
  openApp,
  payee,
  resetGlobals,
  saveAmount,
  saveButton,
  type Opened,
} from './support/transactionScreen'
import { installMatchMedia, resetViewport } from './support/viewport'

/*
 * 넓은 화면(1024px 이상) 두 칸 화면의 오른쪽 칸에서 여는 입력(00-common 5.5, D-04·G-02 넓은 화면, #244 둘째 PR).
 * 휴대폰 배치와 목록이 아닌 화면에서 연 입력은 지금처럼 전체 화면이다(TransactionEditPage, TransactionNewPage, AccountAddPage 테스트).
 */

const server = startMockServer()
let started: ReturnType<typeof startEditServer>
let food: Item
let move: Item

beforeEach(() => {
  deviceNow()
  vi.stubGlobal('scrollTo', vi.fn())
  started = startEditServer(server)
  food = lunch()
  move = saving()
  started.put(food, move)
  // 새로 만든 거래는 상세에서도 보인다
  started.transactions.response = (sent) => {
    const saved = savedOf(sent.body, sent.user)
    started.detail.put(saved)
    return HttpResponse.json(saved, { status: 201 })
  }
  localStorage.clear()
  sessionStorage.clear()
  installMatchMedia(1280)
})

afterEach(() => {
  cleanup()
  resetViewport()
  resetGlobals()
})

const main = () => screen.getByRole('main')
/** 목록 칸 옆의 오른쪽 칸(main의 둘째 자식) */
const pane = () => main().children[1] as HTMLElement
const paneHeading = (name: string) => within(pane()).queryByRole('heading', { level: 2, name })
/** 목록 칸의 거래 줄 */
const listRows = () => main().children[0].querySelectorAll('li > a[href^="/transactions/"]')
const address = ({ router }: Opened) => router.state.location.pathname
const sidebar = () => document.querySelector<HTMLElement>('[class*="sidebar"]')!
/** 사이드바의 "거래 입력". 넓은 화면의 CSS를 다시 쓰지 않으므로 사이드바는 접근성 트리에서 숨은 채다 */
const quickEntry = () => within(sidebar()).getByRole('link', { name: '거래 입력', hidden: true })

async function openList() {
  const opened = await openApp('/transactions?month=2026-11')
  await rowOf(food)
  return opened
}

/** 줄을 눌러 상세를 열고 "수정"을 눌러 칸에 거래 수정을 연다 */
async function openEditInPane() {
  const opened = await openList()
  await opened.user.click(await rowOf(food))
  await untilDetail()
  await opened.user.click(editLink()!)
  await waitFor(() => expect(paneHeading('거래 수정')).toBeTruthy())
  await waitFor(() => expect(amount().value).not.toBe(''))
  return opened
}

describe('상세의 "수정"(D-04 수정 넓은 화면)', () => {
  it('오른쪽 칸에 거래 수정을 열고 목록은 그대로다. 머리 왼쪽은 "닫기"이고 저장 자리는 칸 맨 아래에 붙는다', async () => {
    const opened = await openEditInPane()
    expect(address(opened)).toBe(editPath(food))
    expect(listRows()).toHaveLength(2)
    const form = within(pane()).getByRole('region', { name: '거래 수정' })
    expect(form.querySelector('header')!.firstElementChild!.textContent).toBe('')
    expect(within(form.querySelector('header')!).getByRole('button', { name: '닫기' })).toBeTruthy()
    // 칸 안에는 화면 전체의 영역(main)을 또 두지 않는다
    expect(within(pane()).queryByRole('main')).toBeNull()
    // 칸의 높이를 채운다(이름 줄 아래의 계좌 칸은 그만큼 낮다)
    expect(getComputedStyle(form).height).toBe('var(--side-pane-height)')
    // 띠가 없으므로 머리 다음 줄이 남은 높이를 다 쓴다(짧은 입력도 저장 자리가 맨 아래다)
    expect(form.children).toHaveLength(2)
    expect(getComputedStyle(form).gridTemplateRows).toBe('auto minmax(0, 1fr)')
    expect(saveButton().closest('form')!.lastElementChild!.contains(saveButton())).toBe(true)
  })

  it('저장하면 칸이 그 거래의 상세로 바뀌고 "저장했어요"가 뜬다. 목록의 스크롤은 그대로다', async () => {
    // 목록을 내려 둔 채 수정을 열었다. 돌아가면 그 위치로 되살리고 맨 위로 옮기지 않는다
    vi.stubGlobal('scrollY', 480)
    const opened = await openEditInPane()
    vi.mocked(window.scrollTo).mockClear()
    await opened.user.type(payee(), ' 2')
    await opened.user.click(saveButton())
    await waitFor(() => expect(address(opened)).toBe(detailPath(food)))
    await untilDetail()
    expect(paneHeading('거래 상세')).toBeTruthy()
    expect(listRows()).toHaveLength(2)
    expect(toastRegion().textContent).toBe('저장했어요')
    expect(window.scrollTo).not.toHaveBeenCalledWith(0, 0)
    // 남아 있는 목록도 고친 내용으로 다시 받는다
    await waitFor(() => expect(within(main().children[0] as HTMLElement).queryByText('김밥천국 2')).toBeTruthy())
  })

  it('고치지 않고 닫으면 목록을 다시 받지 않는다', async () => {
    const opened = await openEditInPane()
    const asked = started.list.requests.length
    await opened.user.click(within(pane()).getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(address(opened)).toBe(detailPath(food)))
    await untilDetail()
    expect(started.list.requests).toHaveLength(asked)
  })

  it('바꾼 것이 있으면 다른 줄을 눌렀을 때 "쓰던 내용을 버릴까요?"를 묻는다. 계속 쓰면 남고, 버리면 그 줄의 상세다', async () => {
    const opened = await openEditInPane()
    await opened.user.type(payee(), ' 2')
    await opened.user.click(await rowOf(move))
    await untilOpened()
    expect(discardQuestion()).toBeTruthy()
    await opened.user.click(screen.getByRole('button', { name: '계속 쓰기' }))
    await waitFor(() => expect(discardQuestion()).toBeNull())
    expect(address(opened)).toBe(editPath(food))
    expect(payee().value).toBe('김밥천국 2')

    await opened.user.click(await rowOf(move))
    await untilOpened()
    await opened.user.click(screen.getByRole('button', { name: '버리기' }))
    await waitFor(() => expect(address(opened)).toBe(detailPath(move)))
  })

  it('뒤로도 바꾼 것이 있으면 묻는다(useBlocker)', async () => {
    const opened = await openEditInPane()
    await opened.user.type(payee(), ' 2')
    await opened.router.navigate(-1)
    await untilOpened()
    expect(discardQuestion()).toBeTruthy()
    expect(address(opened)).toBe(editPath(food))
  })

  it('Esc는 칸을 닫고 상세로 돌아간다. 한글을 조합하는 중의 Esc는 받지 않는다', async () => {
    const opened = await openEditInPane()
    fireEvent.keyDown(window, { key: 'Escape', isComposing: true })
    expect(address(opened)).toBe(editPath(food))
    await opened.user.keyboard('{Escape}')
    await waitFor(() => expect(address(opened)).toBe(detailPath(food)))
    await untilDetail()
  })
})

describe('내역에서 사이드바의 "거래 입력"(D-01 넓은 화면)', () => {
  it('오른쪽 칸에 거래 입력을 연다. 저장하면 칸이 저장한 거래의 상세로 바뀌고 "저장했어요"가 뜬다', async () => {
    const opened = await openList()
    await opened.user.click(quickEntry())
    await waitFor(() => expect(paneHeading('거래 입력')).toBeTruthy())
    await waitFor(() => expect(accountField().textContent).not.toBe(''))
    expect(address(opened)).toBe('/transactions/new')
    expect(listRows()).toHaveLength(2)

    await saveAmount(opened.user)
    const sent = started.transactions.sent[0].body
    await waitFor(() => expect(address(opened)).toBe(`/transactions/${String(sent.id)}`))
    await untilDetail()
    expect(paneHeading('거래 상세')).toBeTruthy()
    expect(toastRegion().textContent).toBe('저장했어요')
    // 칸을 바꾼 것이라 상세에서 뒤로 가면 입력이 아니라 목록이다
    await opened.router.navigate(-1)
    await waitFor(() => expect(address(opened)).toBe('/transactions'))
  })

  it('목록이 아닌 화면(홈)에서 누르면 지금처럼 한 칸의 전체 화면 입력이다', async () => {
    const opened = await openApp('/home')
    await opened.user.click(await waitFor(quickEntry))
    await screen.findByRole('heading', { level: 1, name: '거래 입력' })
    expect(address(opened)).toBe('/transactions/new')
    expect(main().querySelector('li > a')).toBeNull()
  })
})

describe('계좌(G-01)의 "추가"(G-02 넓은 화면)', () => {
  async function openAddInPane() {
    started.accounts.items = [accountOf('비상금', 'BANK', 1000000)]
    const opened = await openApp('/accounts')
    await screen.findByText('자산 합계')
    await opened.user.click(screen.getByRole('link', { name: '추가' }))
    await waitFor(() => expect(paneHeading('계좌 추가')).toBeTruthy())
    await screen.findByLabelText('이름')
    return opened
  }

  /**
   * 칸이 닫혀 안내 문구로 돌아올 때까지 기다린다. 라우터는 주소를 먼저 바꾸고 칸은 나중에 그리므로
   * 주소가 /accounts가 된 것으로 칸이 닫혔다고 보지 않는다(test-strategy 8절 8번). 안내 문구는 닫힌 칸에만 있다.
   */
  async function untilPaneClosed() {
    await waitFor(() => expect(within(pane()).queryByText('계좌를 고르면 여기에 자세히 보여요')).toBeTruthy())
    expect(paneHeading('계좌 추가')).toBeNull()
  }

  it('오른쪽 칸에 계좌 추가를 연다. 머리 왼쪽 "닫기"는 칸을 닫는다', async () => {
    const opened = await openAddInPane()
    expect(address(opened)).toBe('/accounts/new')
    expect(within(main().children[0] as HTMLElement).getByText('자산 합계')).toBeTruthy()
    await opened.user.click(within(pane()).getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(address(opened)).toBe('/accounts'))
    await untilPaneClosed()
  })

  it('저장하면 칸을 닫고 토스트를 띄운다', async () => {
    const opened = await openAddInPane()
    await opened.user.click(screen.getByLabelText('이름'))
    await opened.user.paste('급여통장')
    await opened.user.click(screen.getByLabelText('시작 잔액'))
    await opened.user.keyboard('350000')
    await opened.user.click(saveButton())
    await waitFor(() => expect(address(opened)).toBe('/accounts'))
    expect(toastRegion().textContent).toBe("'급여통장' 계좌를 추가했어요")
    await untilPaneClosed()
  })
})
