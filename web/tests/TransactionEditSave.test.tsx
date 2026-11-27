import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { delayed, type Backend } from './support/backend'
import { setDeviceClock } from './support/clock'
import { goOffline, goOnline } from './support/connection'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import { recordDom } from './support/recordDom'
import { holdClock, passTime } from './support/testClock'
import { trashed, type TransactionDetailServer } from './support/transactionDetail'
import {
  deviceNow,
  detailItems,
  detailPath,
  editPath,
  lunch,
  openEdit,
  openFromDetail,
  pathOf,
  rowOf,
  salary,
  saving,
  startEditServer,
  toastText,
  untilDetail,
  type Item,
} from './support/transactionEdit'
import type { TransactionList } from './support/transactionList'
import {
  accountField,
  amount,
  closeButton,
  dateField,
  discardQuestion,
  errorOf,
  id,
  LEDGER,
  memo,
  payee,
  pick,
  resetGlobals,
  saveButton,
  settle,
  time,
  type Opened,
  type User,
} from './support/transactionScreen'
import { resetViewport } from './support/viewport'

/* D-04 거래 수정의 저장(F-208, P-213, P-217). 수정 API(#36)는 가짜 서버가 계약대로 답한다. */

const failed = '문제가 생겨 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'
const lost = '연결이 끊겨 저장하지 못했어요. 연결되면 다시 시도해 주세요.'
const offlineReason = '연결되면 저장할 수 있어요'
const conflict = '다른 기기에서 먼저 고쳤어요'
/** planner 확정(#89, 2026-11-26) */
const deletedMeanwhile = '그사이 삭제된 거래라 저장하지 못했어요'

const server = startMockServer()
let backend: Backend
let detail: TransactionDetailServer
let list: TransactionList
let put: (...items: Item[]) => void

beforeEach(() => {
  deviceNow()
  vi.stubGlobal('scrollTo', vi.fn())
  ;({ backend, detail, list, put } = startEditServer(server))
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  resetViewport()
  resetGlobals()
})

const sentBodies = () => detail.requests.update.map(({ body }) => body)
const retryButton = () => screen.getByRole('button', { name: '다시 시도' })
const latestLink = () => screen.queryByRole('link', { name: '최신 내용 보기' })
const deletedLink = () => screen.queryByRole('link', { name: '삭제된 거래 보기' })
const backButton = () => screen.getByRole('button', { name: '뒤로' })
const notFound = () => screen.findByRole('heading', { level: 1, name: '찾을 수 없어요.' })

const refuse =
  (...fieldErrors: [field: string, code: string][]) =>
  () =>
    problem(400, 'VALIDATION_FAILED', {
      fieldErrors: fieldErrors.map(([field, code]) => ({ field, code, message: '개발자가 읽는 글' })),
    })

/** 금액을 30,000원으로 바꾼다. */
async function changeAmount(user: User, typed = '30000') {
  await user.clear(amount())
  await user.keyboard(typed)
}

async function changeAndSave(user: User) {
  await changeAmount(user)
  await user.click(saveButton())
}

/** 상세(앞 화면)에서 연 수정 화면에서 금액을 바꿔 저장하고 실패 문구가 뜰 때까지 기다린다. */
async function failToSave(respond: () => Response | Promise<Response>) {
  const item = lunch()
  put(item)
  detail.updateResponse = respond
  const opened = await openFromDetail(item)
  await changeAndSave(opened.user)
  await screen.findByRole('alert')
  return { ...opened, item }
}

describe('저장에 성공', () => {
  it('받아 둔 version과 바꾼 값을 계약의 모양 그대로 한 번 보낸다(거래 id는 본문에 없다)', async () => {
    const item = lunch({ version: 3 })
    put(item)
    const { user } = await openFromDetail(item)
    await changeAmount(user)
    await user.clear(payee())
    await user.type(payee(), '  김밥나라 ')
    await user.click(saveButton())
    await waitFor(() => expect(detail.requests.update).toHaveLength(1))
    const [sent] = detail.requests.update
    expect([sent.ledgerId, sent.id, sent.user]).toEqual([LEDGER, item.id, 'user-1'])
    expect(sent.device).toMatch(/^[a-z]+\.[a-z]+$/)
    expect(sent.body).toEqual({
      type: 'EXPENSE',
      occurredOn: '2026-11-25',
      occurredTime: '13:05',
      accountId: id.wallet,
      categoryId: id.dining,
      amount: 30000,
      payee: '김밥나라',
      memo: '팀 점심\n영수증은 사진첩에',
      version: 3,
    })
  })

  it('상세로 돌아가 바뀐 값을 보이고 토스트 "저장했어요"가 뜬다', async () => {
    const item = lunch()
    put(item)
    const opened = await openFromDetail(item)
    await changeAndSave(opened.user)
    await untilDetail()
    expect(pathOf(opened)).toBe(detailPath(item))
    await waitFor(() => expect(toastText()).toBe('저장했어요'))
    expect(within(screen.getByRole('main')).getByText('30,000원')).toBeTruthy()
  })

  it('상세는 다시 받기를 기다리지 않고 받은 거래로 바로 그린다', async () => {
    const item = lunch()
    put(item)
    const opened = await openFromDetail(item)
    detail.getResponse = delayed().respond
    await changeAndSave(opened.user)
    await untilDetail()
    expect(within(screen.getByRole('main')).getByText('30,000원')).toBeTruthy()
  })

  it('방문 기록에 수정 화면이 남지 않아 상세에서 뒤로 가면 내역이다', async () => {
    const item = lunch()
    put(item)
    const opened = await openFromDetail(item)
    await changeAndSave(opened.user)
    await untilDetail()
    await opened.user.click(backButton())
    await waitFor(() => expect(pathOf(opened)).toBe('/transactions'))
  })

  it('주소로 바로 열었으면 방문 기록을 그 거래의 상세로 바꾼다', async () => {
    const item = lunch()
    put(item)
    const opened = await openEdit(item)
    await changeAndSave(opened.user)
    await waitFor(() => expect(pathOf(opened)).toBe(detailPath(item)))
    expect(opened.router.state.historyAction).toBe('REPLACE')
  })

  it('내역의 줄과 합계도 바뀐 값으로 다시 받는다', async () => {
    const item = lunch()
    put(item)
    const opened = await openFromDetail(item)
    const before = list.requests.length
    await changeAndSave(opened.user)
    await untilDetail()
    await opened.user.click(backButton())
    await waitFor(() => expect(list.requests.length).toBeGreaterThan(before))
    const row = await rowOf(item)
    await waitFor(() => expect(row.textContent).toContain('30,000원'))
    // 달 합계
    expect(screen.getByRole('main').textContent).toContain('수입0원지출30,000원')
  })

  it('수입: 미분류는 null, 빈 가맹점·시각·메모는 null로 보낸다', async () => {
    const item = salary()
    put(item)
    const { user } = await openFromDetail(item)
    await changeAmount(user, '3300000')
    await user.click(saveButton())
    await waitFor(() => expect(detail.requests.update).toHaveLength(1))
    expect(sentBodies()[0]).toEqual({
      type: 'INCOME',
      occurredOn: '2026-11-25',
      occurredTime: null,
      accountId: id.salary,
      categoryId: null,
      amount: 3300000,
      payee: null,
      memo: null,
      version: 1,
    })
  })

  it('이체: 보내는 계좌와 받는 계좌로 보낸다', async () => {
    const item = saving()
    put(item)
    const { user } = await openFromDetail(item)
    await pick(user, accountField('받는 계좌'), '지갑')
    await user.click(memo())
    await user.keyboard('비상금 대신')
    await user.click(saveButton())
    await waitFor(() => expect(detail.requests.update).toHaveLength(1))
    expect(sentBodies()[0]).toEqual({
      type: 'TRANSFER',
      occurredOn: '2026-11-24',
      occurredTime: '09:00',
      fromAccountId: id.salary,
      toAccountId: id.wallet,
      amount: 500000,
      memo: '비상금 대신',
      version: 1,
    })
  })

  it('시각을 지우면 시각 없음(null)으로 보내고 상세에 "시각 없음"이 보인다', async () => {
    const item = lunch()
    put(item)
    const { user } = await openFromDetail(item)
    await user.clear(time())
    await user.click(saveButton())
    await untilDetail()
    expect(sentBodies()[0]).toMatchObject({ occurredTime: null })
    expect(detailItems()[0]).toEqual(['날짜·시각', '11월 25일 (수) · 시각 없음'])
  })

  it('두 번 누르거나 Ctrl+엔터를 함께 눌러도 한 번만 보낸다', async () => {
    const item = lunch()
    put(item)
    const answer = delayed()
    detail.updateResponse = answer.respond
    const { user } = await openFromDetail(item)
    await changeAmount(user)
    await user.click(saveButton())
    await user.click(saveButton())
    fireEvent.keyDown(amount(), { key: 'Enter', ctrlKey: true })
    await answer.arrived
    await settle()
    expect(detail.requests.update).toHaveLength(1)
  })
})

describe('바꾼 값 없이 저장', () => {
  it('요청 없이 상세로 돌아가고 토스트가 없다', async () => {
    const item = lunch()
    put(item)
    const opened = await openFromDetail(item)
    await opened.user.click(saveButton())
    await untilDetail()
    await settle()
    expect(detail.requests.update).toEqual([])
    expect(toastText()).toBe('')
  })

  it('바꿨다가 되돌렸거나 보낼 값이 같아지면(앞뒤 공백) 바꾸지 않은 것이다', async () => {
    const item = lunch()
    put(item)
    const opened = await openFromDetail(item)
    await changeAmount(opened.user)
    await changeAmount(opened.user, '25000')
    await opened.user.click(payee())
    await opened.user.keyboard(' ')
    await opened.user.click(saveButton())
    await untilDetail()
    expect(detail.requests.update).toEqual([])
  })
})

describe('검증은 새 입력과 같다', () => {
  it('금액을 비우면 "1원부터 9,999,999,999원까지 입력할 수 있어요"이고 보내지 않는다', async () => {
    const item = lunch()
    put(item)
    const { user } = await openFromDetail(item)
    await user.clear(amount())
    await user.click(saveButton())
    expect(errorOf(amount())).toBe('1원부터 9,999,999,999원까지 입력할 수 있어요')
    expect(document.activeElement).toBe(amount())
    expect(detail.requests.update).toEqual([])
  })

  it('가맹점/내용이 100자를 넘으면 칸을 벗어날 때 알린다', async () => {
    const item = lunch()
    put(item)
    const { user } = await openFromDetail(item)
    await user.click(payee())
    await user.paste('가'.repeat(100))
    await user.click(memo())
    expect(errorOf(payee())).toBe('100자까지 쓸 수 있어요')
  })

  it('이체에서 받는 계좌를 보내는 계좌와 같게 고르면 바로 알린다', async () => {
    const item = saving()
    put(item)
    const { user } = await openFromDetail(item)
    await pick(user, accountField('받는 계좌'), '급여통장')
    expect(errorOf(accountField('받는 계좌'))).toBe('같은 계좌로는 이체할 수 없어요')
  })

  it('서버가 거부한 칸에 문구를 보인다(계좌가 그사이 지워짐)', async () => {
    const item = lunch()
    put(item)
    detail.updateResponse = refuse(['accountId', 'NOT_FOUND'])
    const { user } = await openFromDetail(item)
    await changeAndSave(user)
    await waitFor(() => expect(errorOf(accountField())).toBe('고른 계좌가 삭제되었어요. 다른 계좌를 골라 주세요.'))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('연결이 없을 때(00-common 4.3, 02의 0.10, #238)', () => {
  it('화면은 열리고 값을 쓸 수 있지만 저장은 비활성이고 바로 위에 "연결되면 저장할 수 있어요"를 보인다. 돌아오면 지운다', async () => {
    const item = lunch()
    put(item)
    const { user } = await openFromDetail(item)
    act(() => goOffline())
    expect(saveButton().getAttribute('aria-disabled')).toBe('true')
    expect(saveButton().previousElementSibling!.textContent).toBe(offlineReason)
    await changeAndSave(user)
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(amount().value).toBe('30,000')
    expect(detail.requests.update).toEqual([])
    act(() => goOnline())
    expect(screen.queryByText(offlineReason)).toBeNull()
    expect(saveButton().getAttribute('aria-disabled')).toBeNull()
  })

  it('앞선 실패 문구가 있으면 연결이 끊길 때 안내 줄이 그것을 대신하고, 다시 연결돼도 되살리지 않는다(designer #238)', async () => {
    await failToSave(() => problem(500, 'INTERNAL_ERROR'))
    act(() => goOffline())
    expect(screen.queryByText(failed)).toBeNull()
    expect(saveButton().previousElementSibling!.textContent).toBe(offlineReason)
    act(() => goOnline())
    expect(screen.queryByText(offlineReason)).toBeNull()
    expect(screen.queryByText(failed)).toBeNull()
  })

  it('요청 중에 끊기면 그 줄 대신 "연결이 끊겨 저장하지 못했어요."와 "다시 시도"(연결이 없는 동안 비활성)이고, 돌아와도 저절로 다시 보내지 않는다', async () => {
    const { user } = await failToSave(() => HttpResponse.error())
    expect(screen.getByRole('alert').textContent).toBe(lost)
    expect(screen.queryByText(offlineReason)).toBeNull()
    expect(retryButton().getAttribute('aria-disabled')).toBe('true')
    expect(saveButton().getAttribute('aria-disabled')).toBe('true')
    expect(amount().value).toBe('30,000')
    detail.updateResponse = undefined
    act(() => goOnline())
    await settle(100)
    expect(detail.requests.update).toHaveLength(1)
    expect(retryButton().getAttribute('aria-disabled')).toBeNull()
    await user.click(retryButton())
    await waitFor(() => expect(detail.requests.update).toHaveLength(2))
  })
})

describe('저장하지 못함', () => {
  it.each([
    ['500', () => problem(500, 'INTERNAL_ERROR')],
    ['읽을 수 없는 502', () => new HttpResponse('<html>', { status: 502 })],
    ['429', () => problem(429, 'TOO_MANY_REQUESTS')],
    ['유형이 다르다는 400', refuse(['type', 'NOT_ALLOWED'])],
    ['version 형식 400', refuse(['version', 'INVALID_FORMAT'])],
    ['약속과 다른 200', () => HttpResponse.json({})],
    ['모르는 409', () => problem(409, 'IN_USE')],
  ])('%s이면 저장 바로 위에 문구와 "다시 시도"를 보이고 입력값이 남는다', async (_, respond) => {
    const opened = await failToSave(respond)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe(failed)
    const notice = saveButton().previousElementSibling as HTMLElement
    expect(notice.contains(alert)).toBe(true)
    expect(notice.contains(retryButton())).toBe(true)
    expect(amount().value).toBe('30,000')
    expect(pathOf(opened)).toBe(editPath(opened.item))
    expect(document.body.textContent).not.toContain('개발자가 읽는')
  })

  it('15초 동안 응답이 없으면 같은 문구를 보인다', async () => {
    const item = lunch()
    put(item)
    detail.updateResponse = delayed().respond
    const { user } = await openFromDetail(item)
    await changeAmount(user)
    holdClock()
    fireEvent.click(saveButton())
    await passTime(14_900)
    expect(screen.queryByRole('alert')).toBeNull()
    await passTime(200)
    expect(screen.getByRole('alert').textContent).toBe(failed)
  })

  it('실패해도 초점을 옮기지 않는다', async () => {
    const item = lunch()
    put(item)
    detail.updateResponse = () => problem(500, 'INTERNAL_ERROR')
    const { user } = await openFromDetail(item)
    await changeAmount(user)
    await user.click(payee())
    await user.keyboard('{Enter}')
    await screen.findByRole('alert')
    await settle()
    expect(document.activeElement).toBe(payee())
  })

  it('"다시 시도"는 같은 본문과 version으로 보내고 저절로 다시 보내지 않는다', async () => {
    const { user } = await failToSave(() => problem(500, 'INTERNAL_ERROR'))
    await settle(100)
    expect(detail.requests.update).toHaveLength(1)
    detail.updateResponse = () => problem(503, 'INTERNAL_ERROR')
    await user.click(retryButton())
    await waitFor(() => expect(detail.requests.update).toHaveLength(2))
    expect(sentBodies()[1]).toEqual(sentBodies()[0])
  })

  it('"다시 시도"를 누르면 문구를 둔 채 그 버튼만 도는 표시이고, 저장은 누를 수 없으며 초점은 "다시 시도"에 남는다', async () => {
    const { user } = await failToSave(() => problem(500, 'INTERNAL_ERROR'))
    const answer = delayed()
    detail.updateResponse = answer.respond
    retryButton().focus()
    await user.keyboard('{Enter}')
    await answer.arrived
    expect(screen.getByRole('alert').textContent).toBe(failed)
    expect(retryButton().getAttribute('aria-busy')).toBe('true')
    expect(saveButton().getAttribute('aria-busy')).toBeNull()
    expect(saveButton().getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(retryButton())
    await user.click(saveButton())
    expect(detail.requests.update).toHaveLength(2)
  })

  it('저장을 다시 누르면 문구를 둔 채 저장만 도는 표시이고 "다시 시도"는 누를 수 없다', async () => {
    const { user } = await failToSave(() => problem(500, 'INTERNAL_ERROR'))
    const answer = delayed()
    detail.updateResponse = answer.respond
    await user.click(saveButton())
    await answer.arrived
    expect(screen.getByRole('alert').textContent).toBe(failed)
    expect(saveButton().getAttribute('aria-busy')).toBe('true')
    expect(retryButton().getAttribute('aria-disabled')).toBe('true')
  })

  it('또 실패하면 문구를 새로 그려 다시 읽히게 한다', async () => {
    const { user } = await failToSave(() => problem(500, 'INTERNAL_ERROR'))
    const first = screen.getByRole('alert')
    await user.click(retryButton())
    await waitFor(() => expect(screen.getByRole('alert')).not.toBe(first))
    expect(screen.getByRole('alert').textContent).toBe(failed)
  })

  it('다시 시도가 성공하면 상세로 돌아가 "저장했어요"다', async () => {
    const opened = await failToSave(() => problem(500, 'INTERNAL_ERROR'))
    detail.updateResponse = undefined
    await opened.user.click(retryButton())
    await untilDetail()
    await waitFor(() => expect(toastText()).toBe('저장했어요'))
  })

  it('실패한 뒤 닫으면 버릴지 묻는다', async () => {
    const { user } = await failToSave(() => problem(500, 'INTERNAL_ERROR'))
    await user.click(closeButton())
    expect(discardQuestion()).toBeTruthy()
  })
})

/*
 * 최신 거래(current)가 온 충돌은 수정 충돌 안내(N-04) 판이다(EditConflict.test.tsx). 최신 거래가 오지 않았으면 판을 그릴 수 없어
 * 1A처럼 저장 위에 안내와 "최신 내용 보기"만 보인다(planner #239 P3).
 */
describe('다른 기기가 먼저 고침(409 STALE_VERSION), 최신 거래 없음', () => {
  /** 다른 기기가 금액을 40,000원으로 고쳐 서버의 version이 2가 된 거래 */
  function changedElsewhere(item: Item) {
    Object.assign(item, { amount: 40000, version: 2 })
  }

  it('저장 바로 위에 "다른 기기에서 먼저 고쳤어요"와 "최신 내용 보기" 하나만 보이고 초점을 옮기지 않는다', async () => {
    const item = lunch()
    put(item)
    detail.updateResponse = () => problem(409, 'STALE_VERSION')
    const opened = await openFromDetail(item)
    await changeAmount(opened.user)
    const focused = document.activeElement
    await opened.user.click(saveButton())
    await waitFor(() => expect(screen.queryByText(conflict)).toBeTruthy())
    await settle()
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe(conflict)
    const notice = saveButton().previousElementSibling as HTMLElement
    expect(notice.contains(alert)).toBe(true)
    expect(notice.contains(latestLink())).toBe(true)
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull()
    expect(document.activeElement).toBe(focused)
    expect(amount().value).toBe('30,000')
  })

  it('최신 거래(current)가 오지 않아도 같은 안내이고, 상세는 최신을 다시 받는다', async () => {
    const item = lunch()
    put(item)
    detail.updateResponse = () => problem(409, 'STALE_VERSION')
    const opened = await openFromDetail(item)
    await changeAndSave(opened.user)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(conflict))
    changedElsewhere(item)
    await opened.user.click(latestLink()!)
    await untilDetail()
    await waitFor(() => expect(within(screen.getByRole('main')).getByText('40,000원')).toBeTruthy())
  })
})

/*
 * 다른 기기가 휴지통으로 옮겨 최신 거래가 휴지통에 있는 충돌(STALE_VERSION의 current)은 N-04 판이다(EditConflict.test.tsx).
 * version은 맞는데 휴지통인 거부(INVALID_STATE, current 없음)는 1A 그대로다(planner #239 P3).
 */
describe('그사이 휴지통으로 간 거래(planner·designer #102)', () => {
  const trashedElsewhere: [string, (item: Item) => void][] = [
    ['version은 맞는데 휴지통(INVALID_STATE)', (item) => Object.assign(item, trashed('2026-11-26T03:15:00.123Z'))],
  ]

  async function saveAfterTrashed(trash: (item: Item) => void) {
    const item = lunch()
    put(item)
    const opened = await openFromDetail(item)
    trash(item)
    await changeAmount(opened.user)
    // 저장을 눌러도 초점은 쓰던 칸에 남는다(FullScreenForm)
    const focused = document.activeElement
    await opened.user.click(saveButton())
    await waitFor(() => expect(screen.queryByText(deletedMeanwhile)).toBeTruthy())
    return { ...opened, item, focused }
  }

  it.each(trashedElsewhere)(
    '%s: 수정 화면에 남아 저장 바로 위에 위험색 문구와 "삭제된 거래 보기" 하나만 보이고 초점을 옮기지 않는다',
    async (_, trash) => {
      const { focused, item } = await saveAfterTrashed(trash)
      await settle()
      const alert = screen.getByRole('alert')
      expect(alert.textContent).toBe(deletedMeanwhile)
      const notice = saveButton().previousElementSibling as HTMLElement
      expect(notice.contains(alert)).toBe(true)
      expect(notice.contains(deletedLink())).toBe(true)
      expect(deletedLink()!.getAttribute('href')).toBe(detailPath(item))
      expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull()
      expect(latestLink()).toBeNull()
      expect(document.activeElement).toBe(focused)
      expect(amount().value).toBe('30,000')
      expect(toastText()).toBe('')
    },
  )

  it('문구는 충돌과 같은 위험색 오류 모양이다', async () => {
    await saveAfterTrashed(trashedElsewhere[0][1])
    const message = screen.getByRole('alert')
    expect(getComputedStyle(message).color).toBe('var(--color-danger)')
  })

  it.each(trashedElsewhere)(
    '%s: "삭제된 거래 보기"는 묻지 않고 입력을 버려 휴지통에서 연 그 거래의 상세로 간다. 수정 화면은 방문 기록에 남지 않는다',
    async (_, trash) => {
      const opened = await saveAfterTrashed(trash)
      await opened.user.click(deletedLink()!)
      await waitFor(() => expect(screen.queryByText(/^삭제한 거래예요\./)).toBeTruthy())
      expect(discardQuestion()).toBeNull()
      expect(pathOf(opened)).toBe(detailPath(opened.item))
      expect(detail.requests.update).toHaveLength(1)
      await opened.user.click(backButton())
      await waitFor(() => expect(pathOf(opened)).toBe('/transactions'))
    },
  )

  it('주소로 바로 열었으면 "삭제된 거래 보기"는 방문 기록을 그 거래의 상세로 바꾼다', async () => {
    const item = lunch()
    put(item)
    const opened = await openEdit(item)
    Object.assign(item, trashed('2026-11-26T03:15:00.123Z'))
    await changeAndSave(opened.user)
    await opened.user.click(await waitFor(() => deletedLink()!))
    await waitFor(() => expect(pathOf(opened)).toBe(detailPath(item)))
    expect(opened.router.state.historyAction).toBe('REPLACE')
  })

  it('다시 저장해도 연 때의 version으로 보내 같은 문구를 보인다', async () => {
    const opened = await saveAfterTrashed(trashedElsewhere[0][1])
    const first = screen.getByRole('alert')
    await opened.user.click(saveButton())
    await waitFor(() => expect(detail.requests.update).toHaveLength(2))
    expect(sentBodies().map((body) => (body as { version: number }).version)).toEqual([1, 1])
    await waitFor(() => expect(screen.getByRole('alert')).not.toBe(first))
    expect(screen.getByRole('alert').textContent).toBe(deletedMeanwhile)
  })
})

describe('그사이 완전히 지운 거래(404)', () => {
  it('"찾을 수 없어요."를 보이고 저장 버튼이 없다', async () => {
    const item = lunch()
    put(item)
    const opened = await openFromDetail(item)
    detail.items.delete(String(item.id))
    await changeAndSave(opened.user)
    expect(await notFound()).toBeTruthy()
    expect(screen.queryByRole('button', { name: '저장' })).toBeNull()
    expect(toastText()).toBe('')
  })

  it('찾을 수 없음에서 떠날 때 버릴지 묻지 않는다', async () => {
    const item = lunch()
    put(item)
    const opened = await openFromDetail(item)
    detail.items.delete(String(item.id))
    await changeAndSave(opened.user)
    await notFound()
    await opened.user.click(screen.getByRole('link', { name: '홈으로' }))
    await waitFor(() => expect(pathOf(opened)).toBe('/home'))
    expect(discardQuestion()).toBeNull()
  })
})

// 시간대마다 그 시간대의 2027-01-01 00:30을 오프셋으로 적는다(1월이라 로스앤젤레스는 겨울 시간 −08:00).
// 키리티마티(+14)의 그때는 UTC로 아직 2026-12-31이라, 기기의 시간대를 읽지 않으면 연도를 붙이지 않게 되어 잡힌다
describe.each([
  ['Asia/Seoul', '+09:00'],
  ['UTC', 'Z'],
  ['America/Los_Angeles', '-08:00'],
  ['Pacific/Kiritimati', '+14:00'],
  ['Pacific/Pago_Pago', '-11:00'],
])('기기의 시간대가 %s일 때 해의 경계', (timeZone, offset) => {
  beforeEach(() => setDeviceClock(`2027-01-01T00:30:00${offset}`, timeZone))

  it('저장된 날짜와 시각을 시간대 변환 없이 채우고(지난해는 연도를 붙인다) 그대로 보낸다', async () => {
    const item = lunch({ occurredOn: '2026-12-31', occurredTime: '23:50' })
    put(item)
    const { user } = await openEdit(item)
    expect(dateField().textContent).toBe('2026년 12월 31일')
    expect(time().value).toBe('23:50')
    await changeAmount(user)
    await user.click(saveButton())
    await waitFor(() => expect(detail.requests.update).toHaveLength(1))
    expect(sentBodies()[0]).toMatchObject({ occurredOn: '2026-12-31', occurredTime: '23:50' })
  })

  it('기기의 오늘(새해 첫날)인 거래는 연도 없이 요일을 붙인다', async () => {
    const item = lunch({ occurredOn: '2027-01-01', occurredTime: '00:10' })
    put(item)
    await openEdit(item)
    expect(dateField().textContent).toBe('1월 1일 (금)')
  })
})

describe('처리 중', () => {
  async function startSaving() {
    const item = lunch()
    put(item)
    const answer = delayed()
    detail.updateResponse = answer.respond
    const opened = await openFromDetail(item)
    await changeAndSave(opened.user)
    await answer.arrived
    return { ...opened, answer, item }
  }

  it('저장 버튼만 처리 중이고 칸은 바꿀 수 없다', async () => {
    const { answer } = await startSaving()
    expect(saveButton().getAttribute('aria-busy')).toBe('true')
    expect([amount().readOnly, payee().readOnly, memo().readOnly]).toEqual([true, true, true])
    answer.answer(problem(500, 'INTERNAL_ERROR'))
    await screen.findByRole('alert')
    expect(amount().readOnly).toBe(false)
  })

  it('닫기, Esc, 뒤로로 닫히지 않고 끝나면 상세로 간다', async () => {
    const opened = await startSaving()
    await opened.user.click(closeButton())
    await opened.user.keyboard('{Escape}')
    await act(() => opened.router.navigate(-1))
    await settle()
    expect(pathOf(opened)).toBe(editPath(opened.item))
    expect(discardQuestion()).toBeNull()
    const saved = { ...opened.item, amount: 30000, version: 2 }
    opened.answer.answer(HttpResponse.json(saved))
    await waitFor(() => expect(pathOf(opened)).toBe(detailPath(opened.item)))
  })
})

describe('로그인이 바뀜', () => {
  it('응답이 늦은 사이 로그아웃하면 뒤늦은 응답이 화면과 토스트에 나오지 않는다', async () => {
    const item = lunch()
    put(item)
    const answer = delayed()
    detail.updateResponse = answer.respond
    const opened: Opened = await openFromDetail(item)
    await changeAndSave(opened.user)
    await answer.arrived
    const dom = recordDom()
    await opened.user.click(screen.getByRole('button', { name: '로그아웃', hidden: true }))
    await screen.findByRole('heading', { level: 1, name: '로그인' })
    answer.answer(HttpResponse.json({ ...item, amount: 30000, version: 2 }))
    await settle(100)
    expect(pathOf(opened)).toBe('/login')
    expect(dom.sawText('저장했어요')).toBe(false)
  })

  it('저장하다 로그인이 풀리면 묻지 않고 로그인 화면으로 간다', async () => {
    const item = lunch()
    put(item)
    const { user } = await openFromDetail(item)
    await changeAmount(user)
    backend.expireTokens()
    backend.cookieUser = undefined
    const dom = recordDom()
    await user.click(saveButton())
    await screen.findByRole('heading', { level: 1, name: '로그인' })
    expect(dom.sawElement('dialog')).toBe(false)
  })
})
