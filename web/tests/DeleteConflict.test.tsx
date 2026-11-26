import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { delayed } from './support/backend'
import { setDeviceClock } from './support/clock'
import { goOffline, goOnline } from './support/connection'
import { untilOpened } from './support/dialog'
import { startGuardClock } from './support/guardClock'
import { installIntersectionObserver } from './support/intersection'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import { startTransactionDetail, trashed, type TransactionDetailServer } from './support/transactionDetail'
import { expenseOf, startTransactionList, type TransactionList } from './support/transactionList'
import { id, openApp, resetGlobals, settle, startServer, type Opened } from './support/transactionScreen'
import { installMatchMedia, resetViewport, setViewportWidth } from './support/viewport'

/*
 * 수정 충돌 안내(N-04)의 다른 동작 판(1B는 삭제). 거래 상세(D-06)의 삭제가 409 STALE_VERSION이고 최신 거래(current)가 오면
 * 확인 창이 그 자리에서 이 판으로 바뀐다. (5) 최신 거래 줄, (6) "그래도 삭제할까요?", (7) "다시 하기", (8) "닫기".
 */

const title = '다른 기기에서 먼저 고쳤어요'
const offlineNotice = '연결되면 다시 할 수 있어요'
const lostConnection = '연결이 끊겨 다시 하지 못했어요. 연결되면 다시 시도해 주세요.'
const serverFailure = '문제가 생겨 다시 하지 못했어요. 잠시 후 다시 시도해 주세요.'

const server = startMockServer()
let list: TransactionList
let detail: TransactionDetailServer

beforeEach(() => {
  setDeviceClock('2026-11-26T12:30:00+09:00')
  startGuardClock()
  vi.stubGlobal('scrollTo', vi.fn())
  const { backend } = startServer(server)
  list = startTransactionList(server, backend)
  detail = startTransactionDetail(server, backend)
  installIntersectionObserver()
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  resetViewport()
  resetGlobals()
})

function lunch(changes: object = {}) {
  return expenseOf(
    {
      occurredOn: '2026-11-25',
      occurredTime: '13:05',
      accountId: id.wallet,
      categoryId: id.dining,
      amount: 25000,
      payee: '김밥천국',
    },
    changes,
  )
}

type Item = ReturnType<typeof lunch>

const main = () => screen.getByRole('main')
const board = () => screen.queryByRole('dialog', { name: title })
const confirm = () => screen.queryByRole('dialog', { name: '이 거래를 삭제할까요?' })
/** 판 안의 버튼. "닫기"는 바닥 시트의 X가 아니라 버튼 줄의 것이다. */
const inBoard = (name: string) => within(board()!).getAllByRole('button', { name }).at(-1)!
const retryButton = () => inBoard('다시 하기')
const isDisabled = (button: HTMLElement) => button.getAttribute('aria-disabled') === 'true'
const toastText = () => document.querySelector('[class*="region"]')?.textContent ?? ''
const pathOf = ({ router }: Opened) => router.state.location.pathname
const sentVersions = () => detail.requests.delete.map(({ query }) => query)

/** 다른 기기가 고친 최신 내용. 고친 시각은 서울 12:20이다. */
function changeElsewhere(item: Item, changes: object = {}) {
  Object.assign(item, {
    version: item.version + 1,
    occurredOn: '2026-11-18',
    occurredTime: '12:10',
    amount: 30000,
    payee: '고기국수집',
    accountId: id.card,
    updatedAt: '2026-11-26T03:20:00.000Z',
    ...changes,
  })
}

/** 내역에서 상세로 들어가 삭제를 누르는 사이 다른 기기가 고치고, 실행해 판이 뜰 때까지 기다린다. */
async function conflictOnDelete(elsewhere: object = {}) {
  const item = lunch()
  detail.put(item)
  list.months.set('2026-11', [item])
  const opened = await openApp('/transactions?month=2026-11')
  await opened.user.click(await screen.findByRole('link', { name: /^김밥천국/ }))
  await waitFor(() => expect(within(main()).queryByText('작성자')).toBeTruthy())
  await opened.user.click(within(main()).getByRole('button', { name: '삭제' }))
  await untilOpened()
  changeElsewhere(item, elsewhere)
  await opened.user.click(within(confirm()!).getAllByRole('button', { name: '삭제' }).at(-1)!)
  await waitFor(() => expect(board()).toBeTruthy())
  return { ...opened, item }
}

describe('판이 뜬다', () => {
  it('확인 창 자리에 제목, 고친 시각, 최신 거래 줄, "그래도 삭제할까요?", "닫기"와 위험색 "다시 하기"를 보인다', async () => {
    await conflictOnDelete()
    expect(confirm()).toBeNull()
    const inside = within(board()!)
    expect(inside.getByText('12:20에 고친 내용이 최신이에요')).toBeTruthy()
    expect(inside.getByText('11월 18일 (수) 12:10 고기국수집')).toBeTruthy()
    expect(inside.getByText('외식 · 신한카드')).toBeTruthy()
    expect(inside.getByText('30,000원')).toBeTruthy()
    expect(inside.getByText('그래도 삭제할까요?')).toBeTruthy()
    expect(retryButton().className).toMatch(/danger/)
    expect(inBoard('닫기').className).toMatch(/secondary/)
  })

  it('"닫기"가 왼쪽, "다시 하기"가 오른쪽이고 처음 초점은 "닫기"다', async () => {
    await conflictOnDelete()
    const buttons = [...board()!.querySelectorAll('[class*="actions"] button')].map((button) => button.textContent)
    expect(buttons).toEqual(['닫기', '다시 하기'])
    expect(document.activeElement).toBe(inBoard('닫기'))
  })

  it('최신 거래 줄의 금액은 금액 색 규칙을 따른다', async () => {
    await conflictOnDelete()
    expect(within(board()!).getByText('30,000원').className).toMatch(/expense/)
  })

  it('넓은 화면은 가운데 창이다', async () => {
    installMatchMedia(1280)
    setViewportWidth(1280)
    await conflictOnDelete()
    expect(board()!.querySelector('[class*="window"]')).toBeTruthy()
  })

  it('아래 화면은 최신 내용으로 다시 그린다', async () => {
    await conflictOnDelete()
    const outside = (text: string) => within(main()).getAllByText(text).filter((element) => !element.closest('dialog'))
    expect(outside('30,000원')).toHaveLength(1)
    expect(outside('고기국수집')).toHaveLength(1)
  })
})

describe('다시 하기', () => {
  it('최신 version으로 삭제를 다시 보내고, 성공하면 판을 닫고 "휴지통으로 옮겼어요"와 "되돌리기"를 보인다', async () => {
    const opened = await conflictOnDelete()
    await opened.user.click(retryButton())
    await waitFor(() => expect(pathOf(opened)).toBe('/transactions'))
    // 주소가 먼저 바뀌고 화면은 그 뒤에 그려진다
    await waitFor(() => expect(board()).toBeNull())
    expect(sentVersions()).toEqual(['version=1', 'version=2'])
    await waitFor(() => expect(toastText()).toBe('휴지통으로 옮겼어요되돌리기'))
  })

  it('또 충돌하면 판을 새 최신 내용으로 다시 그리고, 다시 하면 그 version으로 보낸다', async () => {
    const opened = await conflictOnDelete()
    changeElsewhere(opened.item, { amount: 35000, payee: '올래국수', updatedAt: '2026-11-26T03:25:00.000Z' })
    await opened.user.click(retryButton())
    await waitFor(() => expect(within(board()!).queryByText('11월 18일 (수) 12:10 올래국수')).toBeTruthy())
    expect(within(board()!).getByText('12:25에 고친 내용이 최신이에요')).toBeTruthy()
    expect(within(board()!).getByText('35,000원')).toBeTruthy()
    expect(document.activeElement).toBe(inBoard('닫기'))
    await opened.user.click(retryButton())
    await waitFor(() => expect(pathOf(opened)).toBe('/transactions'))
    expect(sentVersions()).toEqual(['version=1', 'version=2', 'version=3'])
  })

  it('다시 보낸 사이 다른 기기가 지웠으면 판을 닫고 삭제한 거래 화면으로 그린다', async () => {
    const opened = await conflictOnDelete()
    Object.assign(opened.item, { version: 3, ...trashed('2026-11-26T03:30:00.000Z') })
    await opened.user.click(retryButton())
    await waitFor(() => expect(board()).toBeNull())
    expect(screen.getByText('삭제한 거래예요. 30일 뒤 영구 삭제돼요.')).toBeTruthy()
    expect(toastText()).toBe('')
  })

  it('처리 중에는 "다시 하기" 안에 돌아가는 원이 있고 두 버튼은 비활성이며, 바깥을 눌러도 닫히지 않는다', async () => {
    const answer = delayed()
    const opened = await conflictOnDelete()
    detail.deleteResponse = answer.respond
    await opened.user.click(retryButton())
    await answer.arrived
    expect(retryButton().getAttribute('aria-busy')).toBe('true')
    expect(isDisabled(retryButton())).toBe(true)
    expect(isDisabled(inBoard('닫기'))).toBe(true)
    fireEvent.pointerDown(board()!)
    fireEvent.click(board()!)
    await opened.user.click(inBoard('닫기'))
    await settle()
    expect(board()).toBeTruthy()
    answer.answer(HttpResponse.json({ ...opened.item, version: 3, ...trashed('2026-11-26T03:30:00.000Z') }))
    await waitFor(() => expect(pathOf(opened)).toBe('/transactions'))
  })
})

describe('닫기', () => {
  it('"닫기"는 판을 닫고 아래 화면을 최신 내용으로 둔다', async () => {
    const opened = await conflictOnDelete()
    await opened.user.click(inBoard('닫기'))
    await waitFor(() => expect(board()).toBeNull())
    expect(within(main()).getByText('30,000원')).toBeTruthy()
    expect(sentVersions()).toEqual(['version=1'])
  })

  it('판 바깥을 누르면 "닫기"와 같다', async () => {
    await conflictOnDelete()
    fireEvent.pointerDown(board()!)
    fireEvent.click(board()!)
    await waitFor(() => expect(board()).toBeNull())
    expect(within(main()).getByText('30,000원')).toBeTruthy()
  })

  it('닫은 뒤 다시 삭제하면 처음 확인 창부터이고 최신 version으로 보낸다', async () => {
    const opened = await conflictOnDelete()
    await opened.user.click(inBoard('닫기'))
    await waitFor(() => expect(board()).toBeNull())
    await opened.user.click(within(main()).getByRole('button', { name: '삭제' }))
    await untilOpened()
    expect(confirm()).toBeTruthy()
    await opened.user.click(within(confirm()!).getAllByRole('button', { name: '삭제' }).at(-1)!)
    await waitFor(() => expect(pathOf(opened)).toBe('/transactions'))
    expect(sentVersions()).toEqual(['version=1', 'version=2'])
  })
})

describe('연결과 서버 오류', () => {
  it('판이 떠 있는 동안 연결이 끊기면 "다시 하기"는 비활성이고 그 바로 위에 "연결되면 다시 할 수 있어요". "닫기"는 된다', async () => {
    const opened = await conflictOnDelete()
    goOffline()
    await waitFor(() => expect(within(board()!).queryByText(offlineNotice)).toBeTruthy())
    expect(isDisabled(retryButton())).toBe(true)
    const actions = board()!.querySelector('[class*="actions"]')!
    expect(actions.previousElementSibling!.textContent).toBe(offlineNotice)
    await opened.user.click(retryButton())
    await settle()
    expect(sentVersions()).toEqual(['version=1'])
    goOnline()
    await waitFor(() => expect(within(board()!).queryByText(offlineNotice)).toBeNull())
    expect(isDisabled(retryButton())).toBe(false)
    goOffline()
    await opened.user.click(inBoard('닫기'))
    await waitFor(() => expect(board()).toBeNull())
  })

  it('요청 중에 연결이 끊기면 위에 문구를 보이고 버튼 글자가 "다시 시도"(연결이 없는 동안 비활성)가 된다', async () => {
    const opened = await conflictOnDelete()
    detail.deleteResponse = () => HttpResponse.error()
    await opened.user.click(retryButton())
    const alert = await within(board()!).findByRole('alert')
    expect(alert.textContent).toBe(lostConnection)
    const again = inBoard('다시 시도')
    expect(isDisabled(again)).toBe(true)
    expect(within(board()!).queryByText(offlineNotice)).toBeNull()
    expect(document.activeElement).toBe(again)
    detail.deleteResponse = undefined
    goOnline()
    await waitFor(() => expect(isDisabled(inBoard('다시 시도'))).toBe(false))
    await opened.user.click(inBoard('다시 시도'))
    await waitFor(() => expect(pathOf(opened)).toBe('/transactions'))
    expect(sentVersions()).toEqual(['version=1', 'version=2', 'version=2'])
  })

  it('서버 오류면 "문제가 생겨 다시 하지 못했어요."와 "다시 시도"이고 초점은 "다시 시도"다', async () => {
    const opened = await conflictOnDelete()
    detail.deleteResponse = () => problem(500, 'INTERNAL_ERROR')
    await opened.user.click(retryButton())
    const alert = await within(board()!).findByRole('alert')
    expect(alert.textContent).toBe(serverFailure)
    expect(document.activeElement).toBe(inBoard('다시 시도'))
    expect(isDisabled(inBoard('다시 시도'))).toBe(false)
    detail.deleteResponse = undefined
    await opened.user.click(inBoard('다시 시도'))
    await waitFor(() => expect(pathOf(opened)).toBe('/transactions'))
  })
})
