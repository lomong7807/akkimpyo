import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setDeviceClock } from './support/clock'
import { untilOpened } from './support/dialog'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import { trashed, type TransactionDetailServer } from './support/transactionDetail'
import {
  deviceNow,
  detailPath,
  editPath,
  lunch,
  openFromDetail,
  pathOf,
  saving,
  startEditServer,
  toastText,
  untilDetail,
  type Item,
} from './support/transactionEdit'
import { amount, discardQuestion, id, memo, payee, resetGlobals, saveButton, settle, time, type User } from './support/transactionScreen'
import { installMatchMedia, resetViewport, setViewportWidth } from './support/viewport'

/*
 * 수정 충돌 안내(N-04, F-909, P-217, ADR 006 결정 5). 거래 수정(D-04)의 저장이 409 STALE_VERSION이고 최신 거래(current)가
 * 오면 저장하지 않고 그 화면 위에 판을 띄운다. 휴대폰은 바닥 시트, 넓은 화면은 가운데 창이고 주소가 없다.
 */

const title = '다른 기기에서 먼저 고쳤어요'
const reappliedNotice = '최신 내용에 내가 바꾼 항목을 다시 얹었어요. 확인하고 저장해 주세요.'
const deletedElsewhere = '다른 기기에서 이 거래를 삭제했어요'

const server = startMockServer()
let detail: TransactionDetailServer
let put: (...items: Item[]) => void

beforeEach(() => {
  deviceNow()
  vi.stubGlobal('scrollTo', vi.fn())
  ;({ detail, put } = startEditServer(server))
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  resetViewport()
  resetGlobals()
})

const sheet = () => screen.queryByRole('dialog', { name: title })
const inSheet = (name: string) => within(sheet()!).queryByRole('button', { name })
const reapplyButton = () => inSheet('내 입력 다시 적용')
const latestButton = () => inSheet('최신 내용 보기')
const sentVersions = () => detail.requests.update.map(({ body }) => (body as { version: number }).version)
const notice = () => screen.queryByText(reappliedNotice)

/** 비교 줄마다 [항목, 최신 내용, 내 입력]. 값 앞의 열 이름(화면 읽기용)은 뺀다. */
function compareRows() {
  return [...sheet()!.querySelectorAll('dl > div')].map((row) => [
    row.querySelector('dt')!.textContent,
    ...[...row.querySelectorAll('dd')].map((value) => value.lastElementChild!.textContent),
  ])
}

/** 다른 기기가 고친 내용. 고친 시각은 서울 12:20이다. */
function changeElsewhere(item: Item, changes: object = {}) {
  Object.assign(item, { amount: 40000, version: item.version + 1, updatedAt: '2026-11-26T03:20:00.000Z', ...changes })
}

async function changeAmount(user: User, typed = '30000') {
  await user.clear(amount())
  await user.keyboard(typed)
}

/** 상세에서 연 수정 화면에서 금액을 30,000원으로 바꾸는 사이 다른 기기가 고치고, 저장해 판이 열릴 때까지 기다린다. */
async function conflictOnSave({ elsewhere = {}, item = lunch() }: { elsewhere?: object; item?: Item } = {}) {
  put(item)
  const opened = await openFromDetail(item)
  await changeAmount(opened.user)
  changeElsewhere(item, elsewhere)
  const focused = document.activeElement
  await opened.user.click(saveButton())
  await waitFor(() => expect(sheet()).toBeTruthy())
  await untilOpened()
  return { ...opened, item, focused }
}

describe('판이 열린다', () => {
  it('저장하지 않고 수정 화면 위에 판을 띄운다. 주소는 그대로이고 휴대폰은 바닥 시트다', async () => {
    const opened = await conflictOnSave()
    expect(pathOf(opened)).toBe(editPath(opened.item))
    expect(detail.requests.update).toHaveLength(1)
    expect(opened.item.amount).toBe(40000)
    // 바닥 시트는 머리 오른쪽에 닫기(X)가 있다
    expect(inSheet('닫기')).toBeTruthy()
    expect(toastText()).toBe('')
  })

  it('넓은 화면은 가운데 창이다(X가 없다)', async () => {
    installMatchMedia(1280)
    setViewportWidth(1280)
    await conflictOnSave()
    expect(sheet()!.querySelector('[class*="window"]')).toBeTruthy()
    expect(inSheet('닫기')).toBeNull()
  })

  it('제목 아래에 받은 최신 거래를 고친 시각을 보인다(오늘이면 시각만)', async () => {
    await conflictOnSave()
    expect(within(sheet()!).getByText('12:20에 고친 내용이 최신이에요')).toBeTruthy()
  })

  it('처음 초점은 판 제목이고(designer #239), 판을 닫으면 저장을 누르기 전의 칸으로 돌아온다', async () => {
    const { user, focused } = await conflictOnSave()
    expect(document.activeElement).toBe(within(sheet()!).getByRole('heading', { name: title }))
    expect(document.activeElement!.getAttribute('tabindex')).toBe('-1')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(sheet()).toBeNull())
    expect(document.activeElement).toBe(focused)
  })
})

describe('고친 시각의 자정 경계', () => {
  it.each([
    ['오늘 00:00', '2026-11-25T15:00:00.000Z', '00:00에 고친 내용이 최신이에요'],
    ['어제 23:59', '2026-11-25T14:59:59.999Z', '11월 25일 (수) 23:59에 고친 내용이 최신이에요'],
  ])('기기의 지금이 서울 00:05일 때 %s(%s)에 고쳤으면 "%s"', async (_, updatedAt, text) => {
    setDeviceClock('2026-11-26T00:05:00+09:00')
    await conflictOnSave({ elsewhere: { updatedAt } })
    expect(within(sheet()!).getByText(text)).toBeTruthy()
  })

  it('기기의 시간대로 오늘을 센다(로스앤젤레스의 11월 25일 07:05에 서울 11월 26일 00:00에 고친 것은 오늘이다)', async () => {
    setDeviceClock('2026-11-25T07:05:00-08:00', 'America/Los_Angeles')
    await conflictOnSave({ elsewhere: { updatedAt: '2026-11-25T15:00:00.000Z' } })
    expect(within(sheet()!).getByText('07:00에 고친 내용이 최신이에요')).toBeTruthy()
  })

  it('다른 해면 날짜에 연도를 붙인다', async () => {
    setDeviceClock('2027-01-01T00:05:00+09:00')
    await conflictOnSave({ elsewhere: { updatedAt: '2026-12-31T14:59:00.000Z' } })
    expect(within(sheet()!).getByText('2026년 12월 31일 23:59에 고친 내용이 최신이에요')).toBeTruthy()
  })
})

describe('최신 내용과 내 입력', () => {
  it('두 열 "최신 내용", "내 입력"에 두 값이 다른 항목만 줄로 보인다', async () => {
    await conflictOnSave({ elsewhere: { memo: '팀 점심' } })
    const columns = [...sheet()!.querySelector('[class*="columns"]')!.children].map((column) => column.textContent)
    expect(columns).toEqual(['최신 내용', '내 입력'])
    expect(compareRows()).toEqual([
      ['금액', '40,000원', '30,000원'],
      ['메모', '팀 점심', '팀 점심\n영수증은 사진첩에'],
    ])
  })

  it('항목은 금액, 날짜, 시각, 계좌, 카테고리, 가맹점/내용, 메모 순이고 이름은 칸의 이름과 같다', async () => {
    await conflictOnSave({
      elsewhere: {
        occurredOn: '2026-11-24',
        occurredTime: '12:10',
        accountId: id.card,
        categoryId: id.grocery,
        payee: '고기국수집',
        memo: null,
      },
    })
    expect(compareRows()).toEqual([
      ['금액', '40,000원', '30,000원'],
      ['날짜', '11월 24일 (화)', '11월 25일 (수)'],
      ['시각', '12:10', '13:05'],
      ['계좌', '신한카드', '지갑'],
      ['카테고리', '장보기 (식비)', '외식 (식비)'],
      ['가맹점/내용', '고기국수집', '김밥천국'],
      ['메모', '(없음)', '팀 점심\n영수증은 사진첩에'],
    ])
  })

  it('값이 없으면 "(없음)", 미분류는 "미분류"다', async () => {
    const item = lunch()
    put(item)
    const opened = await openFromDetail(item)
    await opened.user.clear(time())
    await opened.user.clear(payee())
    changeElsewhere(item, { amount: 25000, categoryId: id.expenseNone })
    await opened.user.click(saveButton())
    await waitFor(() => expect(sheet()).toBeTruthy())
    expect(compareRows()).toEqual([
      ['시각', '13:05', '(없음)'],
      ['카테고리', '미분류', '외식 (식비)'],
      ['가맹점/내용', '김밥천국', '(없음)'],
    ])
  })

  it('이체는 계좌 줄이 "보내는 계좌", "받는 계좌"다', async () => {
    const item = saving()
    put(item)
    const opened = await openFromDetail(item)
    await changeAmount(opened.user, '600000')
    changeElsewhere(item, { amount: 500000, toAccountId: id.wallet })
    await opened.user.click(saveButton())
    await waitFor(() => expect(sheet()).toBeTruthy())
    expect(compareRows()).toEqual([
      ['금액', '500,000원', '600,000원'],
      ['받는 계좌', '지갑', '비상금'],
    ])
  })

  it('값은 굵고, 금액은 오른쪽 정렬과 금액 색이다', async () => {
    await conflictOnSave()
    const [latest, mine] = sheet()!.querySelectorAll('dl > div:first-child dd')
    for (const value of [latest, mine]) {
      expect(getComputedStyle(value).textAlign).toBe('end')
      expect(getComputedStyle(value.lastElementChild!).font).toBe('var(--text-body-strong)')
      expect(value.querySelector('[class*="expense"]')).toBeTruthy()
    }
  })

  it('값 앞에 열 이름이 있어 화면 읽기는 줄마다 어느 열인지 읽는다', async () => {
    await conflictOnSave()
    const [latest, mine] = sheet()!.querySelectorAll('dl > div:first-child dd')
    expect(latest.textContent).toBe('최신 내용 40,000원')
    expect(mine.textContent).toBe('내 입력 30,000원')
  })
})

describe('내 입력 다시 적용', () => {
  it('최신 내용 위에 내가 바꾼 칸만 얹어 다시 채우고, 화면 이름 아래에 안내를 보인다. 보내지 않는다', async () => {
    const { user } = await conflictOnSave({ elsewhere: { payee: '김밥나라', amount: 40000 } })
    await user.click(reapplyButton()!)
    await waitFor(() => expect(sheet()).toBeNull())
    expect(amount().value).toBe('30,000')
    expect(payee().value).toBe('김밥나라')
    expect(memo().value).toBe('팀 점심\n영수증은 사진첩에')
    expect(notice()).toBeTruthy()
    expect(getComputedStyle(notice()!).color).toBe('var(--color-text-secondary)')
    expect(detail.requests.update).toHaveLength(1)
  })

  it('다른 기기가 고친 칸을 나도 고쳤으면 내 값을 얹는다', async () => {
    const { user } = await conflictOnSave({ elsewhere: { amount: 40000, memo: null } })
    await user.click(reapplyButton()!)
    await waitFor(() => expect(sheet()).toBeNull())
    expect(amount().value).toBe('30,000')
    expect(memo().value).toBe('')
  })

  it('다시 저장하면 최신 version으로 보내 저장하고 상세로 돌아가 "저장했어요"', async () => {
    const opened = await conflictOnSave({ elsewhere: { payee: '김밥나라' } })
    await opened.user.click(reapplyButton()!)
    await waitFor(() => expect(sheet()).toBeNull())
    await opened.user.click(saveButton())
    await untilDetail()
    expect(sentVersions()).toEqual([1, 2])
    expect(detail.requests.update[1].body).toMatchObject({ amount: 30000, payee: '김밥나라' })
    expect(pathOf(opened)).toBe(detailPath(opened.item))
    await waitFor(() => expect(toastText()).toBe('저장했어요'))
  })

  it('다시 저장할 때 또 충돌하면 같은 판이 새 최신 내용으로 다시 뜨고, 다시 얹으면 그 version으로 보낸다', async () => {
    const opened = await conflictOnSave()
    await opened.user.click(reapplyButton()!)
    await waitFor(() => expect(sheet()).toBeNull())
    changeElsewhere(opened.item, { amount: 45000, updatedAt: '2026-11-26T03:25:00.000Z' })
    await opened.user.click(saveButton())
    await waitFor(() => expect(sheet()).toBeTruthy())
    await untilOpened()
    expect(within(sheet()!).getByText('12:25에 고친 내용이 최신이에요')).toBeTruthy()
    expect(compareRows()).toEqual([['금액', '45,000원', '30,000원']])
    expect(document.activeElement).toBe(within(sheet()!).getByRole('heading', { name: title }))
    await opened.user.click(reapplyButton()!)
    await waitFor(() => expect(sheet()).toBeNull())
    await opened.user.click(saveButton())
    await untilDetail()
    expect(sentVersions()).toEqual([1, 2, 3])
  })

  it('얹은 값이 최신 내용과 같으면(내가 바꾼 칸을 다른 기기도 같게 바꿈) 다시 저장해도 보내지 않고 닫는다', async () => {
    const item = lunch()
    put(item)
    const opened = await openFromDetail(item)
    await opened.user.clear(payee())
    await opened.user.type(payee(), '김밥나라')
    changeElsewhere(item, { payee: '김밥나라' })
    await opened.user.click(saveButton())
    await waitFor(() => expect(sheet()).toBeTruthy())
    await untilOpened()
    expect(compareRows()).toEqual([['금액', '40,000원', '25,000원']])
    await opened.user.click(reapplyButton()!)
    await waitFor(() => expect(sheet()).toBeNull())
    expect(amount().value).toBe('40,000')
    await opened.user.click(saveButton())
    await untilDetail()
    expect(detail.requests.update).toHaveLength(1)
    expect(toastText()).toBe('')
  })
})

describe('판을 닫는 다른 길', () => {
  /** 판 바깥(가림막)을 누른다. */
  function pressOutside() {
    const dialog = sheet()!
    fireEvent.pointerDown(dialog)
    fireEvent.click(dialog)
  }

  /** 바닥 시트의 머리를 높이의 1/4보다 많이 끌어내린다. */
  async function dragDown() {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(400)
    const head = within(sheet()!).getByRole('heading', { name: title }).closest('[class*="head"]')!
    const pointer = { pointerId: 1, isPrimary: true, button: 0 }
    fireEvent.pointerDown(head, { ...pointer, clientY: 100 })
    fireEvent.pointerMove(head, { ...pointer, clientY: 300 })
    await act(async () => {
      fireEvent.pointerUp(head, { ...pointer, clientY: 300 })
    })
  }

  it.each([
    ['판 바깥을 누르면', async () => pressOutside()],
    ['끌어내리면', dragDown],
    ['X를 누르면', async () => fireEvent.click(inSheet('닫기')!)],
  ])('%s 수정 화면으로 돌아가 내 입력을 그대로 두고, 다시 저장하면 다시 충돌한다', async (_, close) => {
    const opened = await conflictOnSave()
    await close()
    await waitFor(() => expect(sheet()).toBeNull())
    expect(amount().value).toBe('30,000')
    expect(notice()).toBeNull()
    expect(opened.item.amount).toBe(40000)
    await opened.user.click(saveButton())
    await waitFor(() => expect(sheet()).toBeTruthy())
    expect(sentVersions()).toEqual([1, 1])
    expect(opened.item.amount).toBe(40000)
  })
})

describe('최신 내용 보기', () => {
  it('묻지 않고 내 입력을 버려 최신 거래의 상세로 간다. 수정 화면은 방문 기록에 남지 않는다', async () => {
    const opened = await conflictOnSave()
    await opened.user.click(latestButton()!)
    await untilDetail()
    expect(discardQuestion()).toBeNull()
    expect(pathOf(opened)).toBe(detailPath(opened.item))
    expect(within(screen.getByRole('main')).getByText('40,000원')).toBeTruthy()
    expect(detail.requests.update).toHaveLength(1)
    await act(() => opened.router.navigate(-1))
    await waitFor(() => expect(pathOf(opened)).toBe('/transactions'))
  })
})

describe('최신 거래가 휴지통에 있음(같은 계정의 다른 기기가 지움)', () => {
  async function conflictWithTrashed() {
    return conflictOnSave({ elsewhere: { amount: 25000, ...trashed('2026-11-26T03:20:00.000Z') } })
  }

  it('비교 자리에 "다른 기기에서 이 거래를 삭제했어요"를 보이고 "내 입력 다시 적용"을 숨긴다. 초점은 판 제목이다', async () => {
    await conflictWithTrashed()
    expect(within(sheet()!).getByText(deletedElsewhere)).toBeTruthy()
    expect(sheet()!.querySelector('dl')).toBeNull()
    expect(reapplyButton()).toBeNull()
    expect(latestButton()).toBeTruthy()
    expect(document.activeElement).toBe(within(sheet()!).getByRole('heading', { name: title }))
  })

  it('"최신 내용 보기"는 휴지통에서 연 그 거래의 상세(읽기 전용)를 연다', async () => {
    const opened = await conflictWithTrashed()
    await opened.user.click(latestButton()!)
    await waitFor(() => expect(screen.queryByText(/^삭제한 거래예요\./)).toBeTruthy())
    expect(discardQuestion()).toBeNull()
    expect(pathOf(opened)).toBe(detailPath(opened.item))
  })
})

describe('최신 거래가 내가 보낸 값과 같음(앞 저장이 성공했던 경우, planner #239)', () => {
  it('판 없이 저장에 성공한 것으로 보고 상세로 돌아가 "저장했어요"', async () => {
    const item = lunch()
    put(item)
    const opened = await openFromDetail(item)
    await changeAmount(opened.user)
    changeElsewhere(item, { amount: 30000 })
    await opened.user.click(saveButton())
    await untilDetail()
    expect(sheet()).toBeNull()
    expect(pathOf(opened)).toBe(detailPath(item))
    await waitFor(() => expect(toastText()).toBe('저장했어요'))
    expect(within(screen.getByRole('main')).getByText('30,000원')).toBeTruthy()
  })

  it('비교는 고칠 수 있는 칸으로만 한다(가맹점의 앞뒤 공백은 같은 값)', async () => {
    const item = lunch()
    put(item)
    const opened = await openFromDetail(item)
    await opened.user.clear(payee())
    await opened.user.type(payee(), ' 김밥나라 ')
    changeElsewhere(item, { amount: 25000, payee: '김밥나라', status: 'POSTED' })
    await opened.user.click(saveButton())
    await untilDetail()
    expect(sheet()).toBeNull()
    await waitFor(() => expect(toastText()).toBe('저장했어요'))
  })
})

describe('최신 거래(current)가 없거나 읽을 수 없음', () => {
  it('판을 그릴 수 없어 1A처럼 저장 위에 "다른 기기에서 먼저 고쳤어요"와 "최신 내용 보기"를 보인다', async () => {
    const item = lunch()
    put(item)
    detail.updateResponse = () => problem(409, 'STALE_VERSION', { current: { id: item.id, version: 2 } })
    const opened = await openFromDetail(item)
    await changeAmount(opened.user)
    await opened.user.click(saveButton())
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(title))
    await settle()
    expect(sheet()).toBeNull()
    expect(screen.getByRole('link', { name: '최신 내용 보기' })).toBeTruthy()
  })
})
