import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { delayed, meOf, type Backend } from './support/backend'
import { readCssRule } from './support/cssRule'
import { untilOpened } from './support/dialog'
import { installIntersectionObserver } from './support/intersection'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import { startTransactionDetail, trashed, type TransactionDetailServer } from './support/transactionDetail'
import { expenseOf, incomeOf, startTransactionList, transferOf, type TransactionList } from './support/transactionList'
import type { Categories } from './support/categories'
import {
  categoryItems,
  id,
  LEDGER,
  openApp,
  resetGlobals,
  settle,
  startServer,
  type Opened,
} from './support/transactionScreen'
import { resetViewport, setViewportWidth } from './support/viewport'

/* D-06 거래 상세와 삭제(F-224, F-227, F-230 되돌리기). 상세·삭제·복원 API(#15, #38)는 가짜 서버가 계약대로 답한다. */

const CSS = 'src/features/transactions/TransactionDetail.module.css'
const failedToDelete = '문제가 생겨 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.'
const conflict = '다른 기기에서 먼저 고쳤어요'

const server = startMockServer()
let backend: Backend
let categories: Categories
let list: TransactionList
let detail: TransactionDetailServer

/** 기기의 지금. 시각은 기기의 시간대다. */
function deviceNow(...parts: [number, number, number, number?, number?]) {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(...(parts as [number, number, number])) })
}

beforeEach(() => {
  deviceNow(2026, 10, 26, 12, 30)
  vi.stubGlobal('scrollTo', vi.fn())
  ;({ backend, categories } = startServer(server))
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

/** 디자인 시안의 거래. 서버에 있는 것과 목록에 오는 것이 같은 객체라 삭제·복원이 목록에도 보인다. */
function lunch(changes: object = {}) {
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

type Item = ReturnType<typeof lunch>

function put(...items: Item[]) {
  detail.put(...items)
  list.months.set('2026-11', items)
}

const main = () => screen.getByRole('main')
const heading = () => screen.getByRole('heading', { level: 1 })
const addressOf = ({ router }: Opened) => router.state.location.pathname + router.state.location.search
const pathOf = ({ router }: Opened) => router.state.location.pathname
/** 항목 줄의 [이름, 값] */
const items = () =>
  [...main().querySelectorAll('dl > div')].map((row) => [
    row.querySelector('dt')!.textContent,
    row.querySelector('dd')!.textContent,
  ])
const itemNamed = (name: string) =>
  [...main().querySelectorAll('dl > div')].find((row) => row.querySelector('dt')!.textContent === name)!
const deleteButton = () => within(main()).queryByRole('button', { name: '삭제' })
const dialog = () => screen.queryByRole<HTMLDialogElement>('dialog', { name: '이 거래를 삭제할까요?' })
/** 창 안의 버튼. "닫기"는 바닥 시트의 X가 아니라 버튼 줄의 것이다. */
const inDialog = (name: string) => within(dialog()!).getAllByRole('button', { name }).at(-1)!
const toastRegion = () => document.querySelector('[class*="region"]')!
const styleOf = (element: Element) => getComputedStyle(element)

/** 거래 상세를 주소로 바로 열고 항목이 그려질 때까지 기다린다. */
async function openDetail(item: Item, path = `/transactions/${item.id}`) {
  const opened = await openApp(path)
  await screen.findByText('날짜·시각')
  await waitFor(() => expect(within(main()).queryByText('작성자')).toBeTruthy())
  return opened
}

/** 내역(11월)을 열고 그 거래의 줄을 눌러 들어간다. */
async function openFromList(item: Item, { wait = true } = {}) {
  const opened = await openApp('/transactions?month=2026-11')
  const row = await screen.findByRole('link', { name: new RegExp(`^${String(item.payee ?? '')}`) })
  await opened.user.click(row)
  await waitFor(() => expect(heading().textContent).toBe('거래 상세'))
  if (wait) await waitFor(() => expect(within(main()).queryByText('작성자')).toBeTruthy())
  return opened
}

async function askToDelete(opened: Opened) {
  await opened.user.click(deleteButton()!)
  await untilOpened()
}

describe('주소와 상단 바', () => {
  it('/transactions/{id}는 하위 화면 "거래 상세"다. "뒤로"가 있고 1A에는 "수정"이 없다', async () => {
    const item = lunch()
    put(item)
    await openDetail(item)
    expect(heading().textContent).toBe('거래 상세')
    const bar = within(screen.getByRole('banner'))
    expect(bar.getByRole('button', { name: '뒤로' })).toBeTruthy()
    expect(bar.queryByRole('button', { name: '수정' })).toBeNull()
    expect(screen.getByRole('navigation', { name: '주 메뉴' })).toBeTruthy()
  })

  it('장부 경로의 transactions/{id}로 한 번 요청한다', async () => {
    const item = lunch()
    put(item)
    await openDetail(item)
    expect(detail.requests.get.map(({ ledgerId, id }) => [ledgerId, id])).toEqual([[LEDGER, item.id]])
  })

  it('주소의 id가 대문자여도 소문자로 요청한다', async () => {
    const item = lunch()
    put(item)
    await openDetail(item, `/transactions/${String(item.id).toUpperCase()}`)
    expect(detail.requests.get[0].id).toBe(item.id)
  })

  it('"뒤로"는 앞 화면으로, 앞 화면이 없으면 내역으로 간다', async () => {
    const item = lunch()
    put(item)
    const opened = await openDetail(item)
    await opened.user.click(screen.getByRole('button', { name: '뒤로' }))
    await waitFor(() => expect(opened.router.state.location.pathname).toBe('/transactions'))
  })

  it('하단 탭은 "내역"을 강조한다', async () => {
    const item = lunch()
    put(item)
    await openDetail(item)
    const tabs = within(screen.getByRole('navigation', { name: '주 메뉴' }))
    expect(tabs.getByRole('link', { name: '내역' }).getAttribute('aria-current')).toBe('page')
  })
})

describe('찾을 수 없음(N-01)', () => {
  it.each(['abc', '1234', '01900000-0000-7000-8000-00000000000g'])(
    'UUID가 아닌 id(%s)는 요청하지 않고 "찾을 수 없어요."를 보인다',
    async (bad) => {
      await openApp(`/transactions/${bad}`)
      expect(await screen.findByRole('heading', { level: 1, name: '찾을 수 없어요.' })).toBeTruthy()
      await settle()
      expect(detail.requests.get).toEqual([])
    },
  )

  it('없거나 다른 장부의 거래(404)는 "찾을 수 없어요."와 "홈으로"를 보인다', async () => {
    await openApp(`/transactions/${String(lunch().id)}`)
    expect(await screen.findByRole('heading', { level: 1, name: '찾을 수 없어요.' })).toBeTruthy()
    expect(screen.getByText('주소가 바뀌었거나 지워진 항목일 수 있어요.')).toBeTruthy()
    expect(screen.getByRole('link', { name: '홈으로' }).getAttribute('href')).toBe('/home')
  })
})

describe('항목(F-224)', () => {
  it('지출: 유형, 금액, 가맹점, 날짜·시각, 카테고리, 계좌, 메모, 상태, 작성자 순이다', async () => {
    const item = lunch()
    put(item)
    await openDetail(item)
    const summary = main().querySelector('[class*="summary"]')!
    expect(summary.textContent).toBe('지출25,000원김밥천국')
    expect(items()).toEqual([
      ['날짜·시각', '11월 25일 (수) 13:05'],
      ['카테고리', '외식 (식비)'],
      ['계좌', '지갑'],
      ['메모', '팀 점심\n영수증은 사진첩에'],
      ['상태', '완료'],
      ['작성자', 'user-1의 이름'],
    ])
  })

  it('수입은 강조색 "+" 금액이고 계좌 이름이 "들어온 계좌"다', async () => {
    const item = incomeOf({ occurredOn: '2026-11-25', occurredTime: '18:00', accountId: id.salary, categoryId: id.pay, amount: 3200000 })
    put(item)
    await openDetail(item)
    const amount = within(main()).getByText('+3,200,000원')
    expect(styleOf(amount).color).toBe('var(--color-accent)')
    expect(items()[2]).toEqual(['들어온 계좌', '급여통장'])
  })

  it('이체는 가맹점 줄과 카테고리 줄이 없고 "보내는 계좌", "받는 계좌" 두 줄이다', async () => {
    const item = transferOf({ occurredOn: '2026-11-25', fromAccountId: id.salary, toAccountId: id.card, amount: 450000, memo: '카드대금' })
    put(item)
    await openDetail(item)
    const summary = main().querySelector('[class*="summary"]')!
    expect(summary.textContent).toBe('이체450,000원')
    expect(styleOf(within(main()).getByText('450,000원')).color).toBe('var(--color-text-secondary)')
    expect(items()).toEqual([
      ['날짜·시각', '11월 25일 (수) · 시각 없음'],
      ['보내는 계좌', '급여통장'],
      ['받는 계좌', '신한카드'],
      ['메모', '카드대금'],
      ['상태', '완료'],
      ['작성자', 'user-1의 이름'],
    ])
  })

  it('취소한 거래는 금액에 취소선을 긋고(보조 글자색) 상태가 "취소"다', async () => {
    const item = lunch({ status: 'CANCELED' })
    put(item)
    await openDetail(item)
    const amount = within(main()).getByText('25,000원')
    expect(styleOf(amount).textDecoration).toBe('line-through')
    expect(styleOf(amount).color).toBe('var(--color-text-secondary)')
    expect(itemNamed('상태').querySelector('dd')!.textContent).toBe('취소')
  })

  it('시각이 없으면 "11월 25일 (수) · 시각 없음"이고, 다른 해는 연도를 붙이고 요일을 뺀다', async () => {
    const item = lunch({ occurredOn: '2025-11-18', occurredTime: '12:30' })
    put(item)
    await openDetail(item)
    expect(items()[0]).toEqual(['날짜·시각', '2025년 11월 18일 12:30'])
  })

  it('메모가 없으면 메모 줄을 숨긴다', async () => {
    const item = lunch({ memo: null })
    put(item)
    await openDetail(item)
    expect(items().map(([name]) => name)).not.toContain('메모')
  })

  it('가맹점이 없으면 카테고리 이름, 상위 카테고리면 그 이름, 미분류면 "미분류"다', async () => {
    const dining = lunch({ payee: null })
    const food = lunch({ payee: null, categoryId: id.food })
    const none = lunch({ payee: null, categoryId: id.expenseNone })
    for (const [item, title, category] of [
      [dining, '외식', '외식 (식비)'],
      [food, '식비', '식비'],
      [none, '미분류', '미분류'],
    ] as const) {
      put(item)
      await openDetail(item)
      expect(main().querySelector('[class*="payee"]')!.textContent).toBe(title)
      expect(itemNamed('카테고리').querySelector('dd')!.textContent).toBe(category)
      cleanup()
    }
  })

  it('작성자가 탈퇴했으면 "탈퇴한 사용자"다', async () => {
    const item = lunch({ createdBy: null })
    put(item)
    await openDetail(item)
    expect(itemNamed('작성자').querySelector('dd')!.textContent).toBe('탈퇴한 사용자')
  })

  it('목록에 없는 계좌나 카테고리 id면 값 자리를 비운다', async () => {
    const item = lunch({ accountId: '99999999-9999-4999-8999-999999999999', categoryId: '88888888-8888-4888-8888-888888888888' })
    put(item)
    await openDetail(item)
    expect(itemNamed('계좌').querySelector('dd')!.textContent).toBe('')
    expect(itemNamed('카테고리').querySelector('dd')!.textContent).toBe('')
    expect(main().querySelector('[class*="payee"]')!.textContent).toBe('김밥천국')
  })
})

describe('배치와 모양', () => {
  it('유형은 보조 글자색 본문(왼쪽), 금액은 제목 크기(오른쪽)이고 기준선을 맞춘다. 위 24px', async () => {
    const item = lunch()
    put(item)
    await openDetail(item)
    const type = within(main()).getByText('지출')
    const head = type.parentElement!
    expect(styleOf(type).font).toBe('var(--text-body)')
    expect(styleOf(type).color).toBe('var(--color-text-secondary)')
    expect(styleOf(within(main()).getByText('25,000원').parentElement!).font).toBe('var(--text-title)')
    expect(styleOf(head).display).toBe('flex')
    expect(styleOf(head).alignItems).toBe('baseline')
    expect(styleOf(head).flexWrap).toBe('wrap')
    expect(readCssRule(CSS, '.summary')).toContain('padding: var(--space-24) var(--space-16)')
  })

  it('금액이 줄에 안 들어가면(글자 200%) 다음 줄 오른쪽으로 내려간다', () => {
    const rule = readCssRule(CSS, '.amount')
    expect(rule).toContain('margin-inline-start: auto')
    expect(rule).toContain('text-align: end')
  })

  it('가맹점/내용은 본문 글자색 본문이고 8px 아래이며, 그 아래 24px에 1px 선을 긋는다', async () => {
    const item = lunch()
    put(item)
    await openDetail(item)
    const payee = main().querySelector('[class*="payee"]')!
    expect(styleOf(payee).font).toBe('var(--text-body)')
    expect(styleOf(payee).color).toBe('var(--color-text)')
    // jsdom은 p의 margin-top에 건 var()를 계산하지 못한다
    expect(readCssRule(CSS, '.payee')).toContain('margin-top: var(--space-8)')
    expect(styleOf(payee).overflowWrap).toBe('anywhere')
    expect(readCssRule(CSS, '.summary')).toContain('border-bottom: 1px solid var(--color-border)')
  })

  it('선은 휴대폰 배치에서 화면 끝까지, 768px부터 내용 폭이다', async () => {
    const item = lunch()
    put(item)
    await openDetail(item)
    const detailArea = main().querySelector('[class*="detail"]')!
    setViewportWidth(390)
    expect(styleOf(detailArea).getPropertyValue('--bleed')).toBe('var(--space-16)')
    setViewportWidth(768)
    expect(styleOf(detailArea).getPropertyValue('--bleed')).toBe('0px')
    expect(readCssRule(CSS, '.detail')).toContain('margin-inline: calc(-1 * var(--bleed))')
  })

  it('항목은 선 아래 16px부터이고, 줄은 위아래 8px, 좌우 16px이며 사이에 선이 없다', async () => {
    const item = lunch()
    put(item)
    await openDetail(item)
    const list = main().querySelector('dl')!
    expect(styleOf(list).paddingTop).toBe('var(--space-16)')
    const row = itemNamed('계좌')
    expect(styleOf(row).display).toBe('flex')
    expect(styleOf(row).justifyContent).toBe('space-between')
    expect(styleOf(row).gap).toBe('var(--space-16)')
    expect(readCssRule(CSS, '.item')).toContain('padding: var(--space-8) var(--space-16)')
    expect(readCssRule(CSS, '.item')).not.toMatch(/border|min-height/)
  })

  it('이름은 보조 글자색으로 줄지 않는 한 줄이고, 값은 본문 글자색으로 오른쪽 정렬되며 값만 줄을 바꾼다', async () => {
    const item = lunch()
    put(item)
    await openDetail(item)
    const name = itemNamed('계좌').querySelector('dt')!
    const value = itemNamed('계좌').querySelector('dd')!
    expect(styleOf(name).color).toBe('var(--color-text-secondary)')
    expect(styleOf(name).whiteSpace).toBe('nowrap')
    expect(styleOf(name).flex).toBe('0 0 auto')
    expect(styleOf(value).color).toBe('var(--color-text)')
    expect(styleOf(value).textAlign).toBe('end')
    expect(styleOf(value).overflowWrap).toBe('anywhere')
    expect(styleOf(value).minWidth).toBe('0px')
    expect(styleOf(value).margin).toBe('0px')
    for (const element of [name, value]) expect(styleOf(element).font).toBe('var(--text-body)')
  })

  it('메모는 이름 아래 4px에 값을 왼쪽 정렬로, 줄바꿈 그대로 보인다', async () => {
    const item = lunch()
    put(item)
    await openDetail(item)
    const row = itemNamed('메모')
    expect(styleOf(row).flexDirection).toBe('column')
    expect(styleOf(row).gap).toBe('var(--space-4)')
    const value = row.querySelector('dd')!
    expect(styleOf(value).textAlign).toBe('start')
    expect(styleOf(value).whiteSpace).toBe('pre-line')
  })
})

describe('삭제 버튼', () => {
  it('마지막 항목 아래 40px의 위험색 글자 버튼이고, 안쪽 8px만큼 당겨 글자를 내용의 왼쪽 선에 맞춘다', async () => {
    const item = lunch()
    put(item)
    await openDetail(item)
    const button = deleteButton()!
    expect(styleOf(button).color).toBe('var(--color-danger)')
    const slot = button.parentElement!
    expect(styleOf(slot).marginTop).toBe('var(--space-40)')
    expect(readCssRule(CSS, '.deleteSlot')).toContain('padding-inline: var(--space-16)')
    expect(readCssRule(CSS, '.deleteSlot > *')).toContain('margin-inline-start: calc(-1 * var(--space-8))')
    expect(main().querySelector('dl')!.nextElementSibling).toBe(slot)
  })

  it('보기 전용 구성원에게는 없다. 항목은 같다', async () => {
    backend.meResponse = () => {
      const me = meOf('user-1')
      return HttpResponse.json({ ...me, ledgers: [{ ...me.ledgers[0], role: 'VIEWER' }] })
    }
    const item = lunch()
    put(item)
    await openDetail(item)
    expect(items()).toHaveLength(6)
    expect(deleteButton()).toBeNull()
  })

  it('누르면 확인 창을 연다: 제목, 설명, 왼쪽 "닫기", 오른쪽 위험 버튼 "삭제". 첫 초점은 "닫기"다', async () => {
    const item = lunch()
    put(item)
    const opened = await openDetail(item)
    await askToDelete(opened)
    expect(dialog()).toBeTruthy()
    expect(within(dialog()!).getByText('휴지통으로 옮겨요. 30일 안에 복원할 수 있어요.')).toBeTruthy()
    const [close, action] = [inDialog('닫기'), inDialog('삭제')]
    expect(close.compareDocumentPosition(action)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(styleOf(action).backgroundColor).toBe('var(--color-danger)')
    expect(document.activeElement).toBe(close)
  })

  it('"닫기"를 누르면 아무것도 보내지 않고 닫는다', async () => {
    const item = lunch()
    put(item)
    const opened = await openDetail(item)
    await askToDelete(opened)
    await opened.user.click(inDialog('닫기'))
    await waitFor(() => expect(dialog()).toBeNull())
    expect(detail.requests.delete).toEqual([])
  })
})

describe('삭제(F-227)', () => {
  it('본 version과 기기 값으로 한 번 보내고, 앞 화면(내역)으로 돌아가 "휴지통으로 옮겼어요"와 "되돌리기"를 보인다', async () => {
    const item = lunch({ version: 3 })
    put(item)
    const opened = await openFromList(item)
    await askToDelete(opened)
    await opened.user.click(inDialog('삭제'))
    await waitFor(() => expect(addressOf(opened)).toBe('/transactions?month=2026-11'))
    expect(detail.requests.delete).toHaveLength(1)
    expect(detail.requests.delete[0]).toMatchObject({ ledgerId: LEDGER, id: item.id, query: 'version=3', body: null })
    expect(detail.requests.delete[0].device).toMatch(/^[a-z]+\.[a-z]+$/)
    await waitFor(() => expect(toastRegion().textContent).toBe('휴지통으로 옮겼어요되돌리기'))
    expect(within(toastRegion() as HTMLElement).getByRole('button', { name: '되돌리기' })).toBeTruthy()
  })

  it('돌아간 내역은 다시 받아 지운 줄이 없다', async () => {
    const item = lunch()
    const other = lunch({ payee: '올래국수' })
    put(item, other)
    const opened = await openFromList(item)
    await askToDelete(opened)
    await opened.user.click(inDialog('삭제'))
    await waitFor(() => expect(screen.queryByRole('link', { name: /^김밥천국/ })).toBeNull())
    expect(screen.getByRole('link', { name: /^올래국수/ })).toBeTruthy()
  })

  it('앞 화면이 없으면(주소로 연 상세) 내역으로 바꿔 간다', async () => {
    const item = lunch()
    put(item)
    const opened = await openDetail(item)
    await askToDelete(opened)
    await opened.user.click(inDialog('삭제'))
    await waitFor(() => expect(pathOf(opened)).toBe('/transactions'))
    expect(window.history.state?.idx).toBe(0)
  })

  it('처리 중에는 "삭제"에 도는 표시를 두고 "닫기"를 누를 수 없으며 창이 닫히지 않는다', async () => {
    const answer = delayed()
    detail.deleteResponse = answer.respond
    const item = lunch()
    put(item)
    const opened = await openDetail(item)
    await askToDelete(opened)
    await opened.user.click(inDialog('삭제'))
    await answer.arrived
    expect(inDialog('삭제').getAttribute('aria-busy')).toBe('true')
    expect(within(dialog()!).getAllByRole('button', { name: '닫기' }).every((button) => button.getAttribute('aria-disabled') === 'true')).toBe(true)
    await opened.user.keyboard('{Escape}')
    await opened.user.click(inDialog('닫기'))
    expect(dialog()?.open).toBe(true)
    answer.answer(problem(500, 'INTERNAL_ERROR'))
    await screen.findByRole('alert')
  })

  it('"삭제"를 빠르게 두 번 눌러도 요청은 하나다', async () => {
    const answer = delayed()
    detail.deleteResponse = answer.respond
    const item = lunch()
    put(item)
    const opened = await openDetail(item)
    await askToDelete(opened)
    const action = inDialog('삭제')
    fireEvent.click(action)
    fireEvent.click(action)
    await answer.arrived
    await settle()
    expect(detail.requests.delete).toHaveLength(1)
  })

  it.each([
    ['서버 오류', () => problem(500, 'INTERNAL_ERROR')],
    ['연결 실패', () => HttpResponse.error()],
    ['약속과 다른 응답', () => HttpResponse.json({ id: 'x' })],
  ])('%s면 창이 남고 버튼 위에 문구, 실행 버튼은 "다시 시도"이고 초점이 그리로 간다', async (_, respond) => {
    const answers = [respond]
    detail.deleteResponse = () => answers.shift()?.()
    const item = lunch()
    put(item)
    const opened = await openDetail(item)
    await askToDelete(opened)
    await opened.user.click(inDialog('삭제'))
    const alert = await within(dialog()!).findByRole('alert')
    expect(alert.textContent).toBe(failedToDelete)
    expect(document.activeElement).toBe(inDialog('다시 시도'))
    expect(within(dialog()!).queryByRole('button', { name: '삭제' })).toBeNull()
    await opened.user.click(inDialog('다시 시도'))
    await waitFor(() => expect(pathOf(opened)).toBe('/transactions'))
    expect(detail.requests.delete.map(({ query }) => query)).toEqual(['version=1', 'version=1'])
  })

  it('다시 시도하는 동안 문구를 두고 "다시 시도"에 도는 표시를 둔다', async () => {
    const answer = delayed()
    const answers = [() => problem(500, 'INTERNAL_ERROR'), answer.respond]
    detail.deleteResponse = () => answers.shift()?.()
    const item = lunch()
    put(item)
    const opened = await openDetail(item)
    await askToDelete(opened)
    await opened.user.click(inDialog('삭제'))
    await within(dialog()!).findByRole('alert')
    await opened.user.click(inDialog('다시 시도'))
    await answer.arrived
    expect(within(dialog()!).getByRole('alert').textContent).toBe(failedToDelete)
    expect(inDialog('다시 시도').getAttribute('aria-busy')).toBe('true')
    answer.answer(problem(500, 'INTERNAL_ERROR'))
  })

  it('실패한 뒤 닫았다가 다시 열면 처음 모양이다', async () => {
    detail.deleteResponse = () => problem(500, 'INTERNAL_ERROR')
    const item = lunch()
    put(item)
    const opened = await openDetail(item)
    await askToDelete(opened)
    await opened.user.click(inDialog('삭제'))
    await within(dialog()!).findByRole('alert')
    await opened.user.click(inDialog('닫기'))
    await waitFor(() => expect(dialog()).toBeNull())
    await askToDelete(opened)
    expect(within(dialog()!).queryByRole('alert')).toBeNull()
    expect(inDialog('삭제')).toBeTruthy()
  })

  it('응답이 오기 전에 화면을 떠났으면 늦게 온 성공으로 다른 화면에 토스트를 보이거나 옮겨 가지 않는다', async () => {
    const answer = delayed()
    detail.deleteResponse = answer.respond
    const item = lunch()
    put(item)
    const opened = await openFromList(item)
    await askToDelete(opened)
    await opened.user.click(inDialog('삭제'))
    await answer.arrived
    await act(() => opened.router.navigate('/more'))
    await waitFor(() => expect(dialog()).toBeNull())
    answer.answer(HttpResponse.json({ ...item, version: 2, ...trashed('2026-11-26T03:30:00.000Z') }))
    await settle(100)
    expect(addressOf(opened)).toBe('/more')
    expect(toastRegion().textContent).toBe('')
  })
})

describe('충돌(1A 임시)', () => {
  it('다른 기기가 먼저 고쳤으면 창 안에 "다른 기기에서 먼저 고쳤어요", 실행 버튼 "다시 하기", 초점은 "닫기"이고 화면을 최신 내용으로 그린다', async () => {
    const item = lunch()
    put(item)
    const opened = await openDetail(item)
    Object.assign(item, { version: 2, amount: 30000, payee: '고기국수집' })
    await askToDelete(opened)
    await opened.user.click(inDialog('삭제'))
    const alert = await within(dialog()!).findByRole('alert')
    expect(alert.textContent).toBe(conflict)
    expect(inDialog('다시 하기')).toBeTruthy()
    expect(document.activeElement).toBe(inDialog('닫기'))
    expect(within(main()).getByText('30,000원')).toBeTruthy()
    expect(within(main()).getByText('고기국수집')).toBeTruthy()
  })

  it('"다시 하기"는 최신 version으로 삭제한다', async () => {
    const item = lunch()
    put(item)
    const opened = await openDetail(item)
    Object.assign(item, { version: 2 })
    await askToDelete(opened)
    await opened.user.click(inDialog('삭제'))
    await within(dialog()!).findByRole('alert')
    await opened.user.click(inDialog('다시 하기'))
    await waitFor(() => expect(pathOf(opened)).toBe('/transactions'))
    expect(detail.requests.delete.map(({ query }) => query)).toEqual(['version=1', 'version=2'])
    await waitFor(() => expect(toastRegion().textContent).toBe('휴지통으로 옮겼어요되돌리기'))
  })

  it('"닫기"를 누르면 창을 닫고 최신 내용을 둔다', async () => {
    const item = lunch()
    put(item)
    const opened = await openDetail(item)
    Object.assign(item, { version: 2, amount: 30000 })
    await askToDelete(opened)
    await opened.user.click(inDialog('삭제'))
    await within(dialog()!).findByRole('alert')
    await opened.user.click(inDialog('닫기'))
    await waitFor(() => expect(dialog()).toBeNull())
    expect(within(main()).getByText('30,000원')).toBeTruthy()
  })

  it('다른 기기가 이미 지웠으면 창을 닫고 삭제한 거래 화면으로 그린다', async () => {
    const item = lunch()
    put(item)
    const opened = await openDetail(item)
    Object.assign(item, { version: 2, ...trashed('2026-11-26T03:30:00.000Z') })
    await askToDelete(opened)
    await opened.user.click(inDialog('삭제'))
    await waitFor(() => expect(dialog()).toBeNull())
    expect(screen.getByText('삭제한 거래예요. 30일 뒤 영구 삭제돼요.')).toBeTruthy()
    expect(deleteButton()).toBeNull()
    expect(toastRegion().textContent).toBe('')
  })

  it('상태가 맞지 않으면(INVALID_STATE) 창을 닫고 거래를 다시 받아 그 상태로 그린다', async () => {
    const item = lunch()
    put(item)
    const opened = await openDetail(item)
    Object.assign(item, trashed('2026-11-26T03:30:00.000Z'))
    await askToDelete(opened)
    await opened.user.click(inDialog('삭제'))
    await waitFor(() => expect(dialog()).toBeNull())
    await screen.findByText('삭제한 거래예요. 30일 뒤 영구 삭제돼요.')
    expect(detail.requests.get).toHaveLength(2)
  })
})

describe('되돌리기(F-230)', () => {
  async function deleteFromList(item: Item, other = lunch({ payee: '올래국수' })) {
    put(item, other)
    const opened = await openFromList(item)
    await askToDelete(opened)
    await opened.user.click(inDialog('삭제'))
    await waitFor(() => expect(screen.queryByRole('link', { name: /^김밥천국/ })).toBeNull())
    await waitFor(() => expect(toastRegion().textContent).toBe('휴지통으로 옮겼어요되돌리기'))
    return opened
  }

  const undo = () => within(toastRegion() as HTMLElement).getByRole('button', { name: '되돌리기' })

  it('누르면 토스트가 바로 사라지고 삭제 응답의 version으로 한 번 복원한다', async () => {
    const item = lunch({ version: 3 })
    const opened = await deleteFromList(item)
    await opened.user.click(undo())
    expect(toastRegion().textContent).not.toContain('휴지통으로 옮겼어요')
    await waitFor(() => expect(detail.requests.restore).toHaveLength(1))
    expect(detail.requests.restore[0]).toMatchObject({ id: item.id, body: { version: 4 } })
    expect(detail.requests.restore[0].device).toMatch(/^[a-z]+\.[a-z]+$/)
  })

  it('복원하면 "되돌렸어요"를 보이고 목록에 다시 보인다', async () => {
    const item = lunch()
    const opened = await deleteFromList(item)
    await opened.user.click(undo())
    await waitFor(() => expect(toastRegion().textContent).toBe('되돌렸어요'))
    expect(within(toastRegion() as HTMLElement).queryByRole('button')).toBeNull()
    await screen.findByRole('link', { name: /^김밥천국/ })
  })

  it.each([
    ['서버 오류', () => problem(500, 'INTERNAL_ERROR')],
    ['충돌', () => problem(409, 'STALE_VERSION', { current: lunch() })],
    ['연결 실패', () => HttpResponse.error()],
  ])('%s면 "되돌리지 못했어요"와 "다시 시도"를 보이고, 누르면 같은 복원을 다시 보낸다', async (_, respond) => {
    const answers = [respond]
    detail.restoreResponse = () => answers.shift()?.()
    const item = lunch()
    const opened = await deleteFromList(item)
    await opened.user.click(undo())
    await waitFor(() => expect(toastRegion().textContent).toBe('되돌리지 못했어요다시 시도'))
    await opened.user.click(within(toastRegion() as HTMLElement).getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(toastRegion().textContent).toBe('되돌렸어요'))
    expect(detail.requests.restore.map(({ body }) => body)).toEqual([{ version: 2 }, { version: 2 }])
    await screen.findByRole('link', { name: /^김밥천국/ })
  })
})

describe('삭제한 거래를 주소로 열면', () => {
  it('상단 바 아래 16px에 안내 띠를 보이고 삭제 버튼이 없다. 항목은 같다', async () => {
    const item = lunch({ version: 2, ...trashed('2026-11-24T03:30:00.000Z') })
    detail.put(item)
    await openDetail(item)
    const notice = screen.getByText('삭제한 거래예요. 28일 뒤 영구 삭제돼요.').parentElement!
    expect(styleOf(notice).backgroundColor).toBe('var(--color-border)')
    expect(styleOf(notice).borderRadius).toBe('var(--radius-12)')
    expect(notice.querySelector('svg')).toBeTruthy()
    expect(styleOf(notice.parentElement!).marginTop).toBe('var(--space-16)')
    expect(main().firstElementChild).toBe(notice.parentElement)
    expect(deleteButton()).toBeNull()
    expect(items()).toHaveLength(6)
  })

  it('영구 삭제 시각이 지났으면 "곧"이다', async () => {
    const item = lunch({ version: 2, deletedAt: '2026-10-20T00:00:00.000Z', purgeAt: '2026-11-19T00:00:00.000Z' })
    detail.put(item)
    await openDetail(item)
    expect(screen.getByText('삭제한 거래예요. 곧 영구 삭제돼요.')).toBeTruthy()
  })
})

describe('불러오는 중', () => {
  it('주소로 바로 열면 300ms 뒤 유형·금액, 가맹점, 항목 5줄 자리의 뼈대를 보인다', async () => {
    const answer = delayed()
    detail.getResponse = answer.respond
    const item = lunch()
    put(item)
    await openApp(`/transactions/${item.id}`)
    await screen.findByRole('heading', { level: 1, name: '거래 상세' })
    expect(main().querySelector('[aria-hidden="true"]')).toBeNull()
    await screen.findByText('불러오고 있어요.')
    const bones = main().querySelector('[aria-hidden="true"]')!
    expect(bones.querySelectorAll('[class*="bar"]')).toHaveLength(2 + 1 + 5 * 2)
    expect(bones.querySelectorAll('[class*="item"]')).toHaveLength(5)
    expect(within(main()).queryByRole('button', { name: '삭제' })).toBeNull()
    answer.answer(HttpResponse.json(item))
    await screen.findByText('작성자')
    expect(screen.queryByText('불러오고 있어요.')).toBeNull()
  })

  it('목록에서 들어오면 목록에 있던 유형, 금액, 가맹점, 날짜를 먼저 보이고 나머지만 뼈대다', async () => {
    const item = lunch()
    put(item)
    const answer = delayed()
    detail.getResponse = answer.respond
    await openFromList(item, { wait: false })
    const summary = main().querySelector('[class*="summary"]')!
    expect(summary.textContent).toBe('지출25,000원김밥천국')
    expect(items()).toEqual([['날짜·시각', '11월 25일 (수) 13:05']])
    await screen.findByText('불러오고 있어요.')
    const bones = main().querySelector('[aria-hidden="true"]')!
    expect(bones.querySelectorAll('[class*="item"]')).toHaveLength(4)
    answer.answer(HttpResponse.json(item))
    await screen.findByText('작성자')
    expect(items()).toHaveLength(6)
  })

  it('목록에서 들어온 취소 거래와 이체도 목록의 값으로 먼저 그린다', async () => {
    const canceled = lunch({ status: 'CANCELED' })
    const transfer = transferOf({ occurredOn: '2026-11-25', fromAccountId: id.salary, toAccountId: id.card, amount: 450000 })
    put(canceled, transfer)
    detail.getResponse = delayed().respond
    const opened = await openFromList(canceled, { wait: false })
    expect(styleOf(within(main()).getByText('25,000원')).textDecoration).toBe('line-through')
    await act(() => opened.router.navigate(`/transactions/${transfer.id}`))
    await waitFor(() => expect(main().querySelector('[class*="summary"]')!.textContent).toBe('이체450,000원'))
  })

  it('불러오지 못하면 "불러오지 못했어요."(화면 이름 아래의 2단계 제목)와 "다시 시도"를 보이고, 누르면 다시 받는다', async () => {
    const answers = [() => problem(500, 'INTERNAL_ERROR')]
    detail.getResponse = () => answers.shift()?.()
    const item = lunch()
    put(item)
    const opened = await openApp(`/transactions/${item.id}`)
    expect(await screen.findByRole('heading', { level: 2, name: '불러오지 못했어요.' })).toBeTruthy()
    expect(heading().textContent).toBe('거래 상세')
    await opened.user.click(screen.getByRole('button', { name: '다시 시도' }))
    await screen.findByText('작성자')
    expect(detail.requests.get).toHaveLength(2)
  })

  it('응답이 약속과 달라도 같다', async () => {
    detail.getResponse = () => HttpResponse.json({ ...lunch(), purgeAt: undefined })
    const item = lunch()
    put(item)
    await openApp(`/transactions/${item.id}`)
    expect(await screen.findByRole('heading', { level: 2, name: '불러오지 못했어요.' })).toBeTruthy()
  })

  it('계좌나 카테고리를 못 받아도 같고, "다시 시도"는 못 받은 것만 다시 요청한다', async () => {
    const answers = [() => problem(500, 'INTERNAL_ERROR')]
    categories.response = () => answers.shift()?.() ?? HttpResponse.json({ items: categoryItems })
    const item = lunch()
    put(item)
    const opened = await openApp(`/transactions/${item.id}`)
    await screen.findByRole('heading', { level: 2, name: '불러오지 못했어요.' })
    await opened.user.click(screen.getByRole('button', { name: '다시 시도' }))
    await screen.findByText('작성자')
    expect(categories.requests).toHaveLength(2)
    expect(detail.requests.get).toHaveLength(1)
  })
})

describe.each(['Asia/Seoul', 'UTC', 'America/Los_Angeles'])('기기의 시간대가 %s일 때 해의 경계', (timeZone) => {
  beforeEach(() => vi.stubEnv('TZ', timeZone))

  it('새해 첫날에 본 지난해 12월 31일 거래는 연도를 붙이고, 1월 1일 거래는 요일을 붙인다', async () => {
    deviceNow(2027, 0, 1, 0, 30)
    const lastYear = lunch({ occurredOn: '2026-12-31', occurredTime: '23:59' })
    const newYear = lunch({ occurredOn: '2027-01-01', occurredTime: null })
    detail.put(lastYear, newYear)
    await openDetail(lastYear)
    expect(items()[0]).toEqual(['날짜·시각', '2026년 12월 31일 23:59'])
    cleanup()
    await openDetail(newYear)
    expect(items()[0]).toEqual(['날짜·시각', '1월 1일 (금) · 시각 없음'])
  })
})
