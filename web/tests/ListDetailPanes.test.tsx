import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setDeviceClock } from './support/clock'
import { untilOpened } from './support/dialog'
import { installIntersectionObserver } from './support/intersection'
import { startMockServer } from './support/mockServer'
import { startTransactionDetail, type TransactionDetailServer } from './support/transactionDetail'
import { expenseOf, startTransactionList, type TransactionList } from './support/transactionList'
import { id, openApp, resetGlobals, startServer, type Opened } from './support/transactionScreen'
import { installMatchMedia, resetViewport, setViewportWidth } from './support/viewport'

/*
 * 넓은 화면(1024px 이상)의 목록·상세 두 칸(D-01 (13), G-01 넓은 화면, 00-common 2.5·12.1, L-10, #244).
 * 휴대폰 배치의 내역과 상세는 TransactionListPage.test.tsx와 TransactionDetailPage.test.tsx가 본다.
 */

const server = startMockServer()
let list: TransactionList
let detail: TransactionDetailServer
let window_: ReturnType<typeof installMatchMedia>

const PLACEHOLDER = '거래를 고르면 여기에 자세히 보여요'

beforeEach(() => {
  setDeviceClock('2026-11-26T12:30:00+09:00')
  vi.stubGlobal('scrollTo', vi.fn())
  const { backend } = startServer(server)
  list = startTransactionList(server, backend)
  detail = startTransactionDetail(server, backend)
  installIntersectionObserver()
  localStorage.clear()
  sessionStorage.clear()
  window_ = installMatchMedia(1280)
})

afterEach(() => {
  cleanup()
  resetViewport()
  resetGlobals()
})

type Item = ReturnType<typeof expenseOf>

function expense(payee: string, occurredOn = '2026-11-25', occurredTime = '12:00') {
  return expenseOf({ occurredOn, occurredTime, accountId: id.card, categoryId: id.dining, amount: 9000, payee })
}

/** 그 달 내역과 상세에 같은 거래를 둔다. 삭제하면 내역에서도 빠진다 */
function put(month: string, ...items: Item[]) {
  detail.put(...items)
  list.months.set(month, items)
}

const main = () => screen.getByRole('main')
const styleOf = (element: Element) => getComputedStyle(element)
const addressOf = ({ router }: Opened) => router.state.location.pathname + router.state.location.search
const monthHeading = () => screen.getByRole('heading', { level: 1 })
const rowOf = (payee: string) => screen.getByRole('link', { name: new RegExp(`^${payee}`) })
/** 목록 칸 옆의 오른쪽 칸(main의 둘째 자식) */
const pane = () => main().children[1] as HTMLElement | undefined
const paneTitle = () => within(pane()!).queryByRole('heading', { level: 2, name: '거래 상세' })

async function openList(path = '/transactions?month=2026-11') {
  const opened = await openApp(path)
  await screen.findByRole('heading', { level: 1 })
  await waitFor(() => expect(screen.queryAllByText('수입').length).toBeGreaterThan(0))
  return opened
}

/** 줄을 눌러 오른쪽 칸에 상세를 열고 항목이 그려질 때까지 기다린다 */
async function select(opened: Opened, payee: string) {
  await opened.user.click(rowOf(payee))
  await waitFor(() => expect(paneTitle()).toBeTruthy())
  await waitFor(() => expect(within(pane()!).queryByText('작성자')).toBeTruthy())
}

describe('두 칸 배치(L-10)', () => {
  it('목록 칸(최소 360px)과 오른쪽 칸(440px)이 24px 사이를 두고 나란하다. 오른쪽 칸은 위에 붙고 넘치면 칸 안에서 스크롤한다', async () => {
    put('2026-11', expense('김밥천국'))
    await openList()
    setViewportWidth(1280)
    expect(main().children).toHaveLength(2)
    expect(styleOf(main()).display).toBe('grid')
    expect(styleOf(main()).gridTemplateColumns).toBe('minmax(var(--width-list-min), 1fr) minmax(0, var(--width-side-panel))')
    expect(styleOf(main()).columnGap).toBe('var(--space-24)')
    expect(styleOf(main()).alignItems).toBe('start')
    expect(styleOf(pane()!).position).toBe('sticky')
    expect(styleOf(pane()!).overflowY).toBe('auto')
    expect(within(main().children[0] as HTMLElement).getByRole('heading', { level: 1, name: '11월' })).toBeTruthy()
  })

  it('오른쪽 칸은 처음에 "거래를 고르면 여기에 자세히 보여요"를 보조 글자색으로 가운데에 둔다', async () => {
    put('2026-11', expense('김밥천국'))
    await openList()
    const placeholder = within(pane()!).getByText(PLACEHOLDER)
    expect(styleOf(placeholder).color).toBe('var(--color-text-secondary)')
    expect(styleOf(placeholder.parentElement!).textAlign).toBe('center')
  })

  it('1024px 아래(1023px)는 한 칸이고 1024px부터 두 칸이다', async () => {
    put('2026-11', expense('김밥천국'))
    window_ = installMatchMedia(1023)
    await openList()
    expect(screen.queryByText(PLACEHOLDER)).toBeNull()
    expect(main().children).toHaveLength(1)
    window_.resizeTo(1024)
    expect(await screen.findByText(PLACEHOLDER)).toBeTruthy()
  })
})

describe('줄을 누르면 오른쪽 칸에 상세(D-06)', () => {
  it('화면을 바꾸지 않고 오른쪽 칸에 상세를 보인다. 칸에는 "뒤로"가 없고 대화상자가 아닌 라우트 화면이다', async () => {
    put('2026-11', expense('김밥천국'), expense('올래국수'))
    const opened = await openList()
    const [item] = list.months.get('2026-11')!
    await select(opened, '김밥천국')
    expect(addressOf(opened)).toBe(`/transactions/${item.id}`)
    expect(monthHeading().textContent).toBe('11월')
    expect(rowOf('올래국수')).toBeTruthy()
    expect(within(pane()!).queryByRole('button', { name: '뒤로' })).toBeNull()
    expect(screen.queryByText(PLACEHOLDER)).toBeNull()
    expect(pane()!.closest('dialog')).toBeNull()
    expect(within(pane()!).getByRole('region', { name: '거래 상세' })).toBeTruthy()
  })

  it('고른 줄은 지금 것으로 표시하고 면 색으로 칠한다. 다른 줄을 누르면 표시가 옮겨 간다', async () => {
    put('2026-11', expense('김밥천국'), expense('올래국수'))
    const opened = await openList()
    await select(opened, '김밥천국')
    expect(rowOf('김밥천국').getAttribute('aria-current')).toBe('page')
    expect(rowOf('김밥천국').className).toMatch(/_highlighted_/)
    setViewportWidth(1280)
    expect(styleOf(rowOf('김밥천국')).backgroundColor).toBe('var(--color-surface)')
    await opened.user.click(rowOf('올래국수'))
    await waitFor(() => expect(rowOf('올래국수').getAttribute('aria-current')).toBe('page'))
    expect(rowOf('김밥천국').getAttribute('aria-current')).toBeNull()
    expect(rowOf('김밥천국').className).not.toMatch(/_highlighted_/)
  })

  it('고른 달과 목록의 스크롤을 그대로 둔다', async () => {
    put('2026-10', expense('김밥천국', '2026-10-20'))
    const opened = await openList('/transactions?month=2026-10')
    vi.mocked(window.scrollTo).mockClear()
    await select(opened, '김밥천국')
    expect(monthHeading().textContent).toBe('10월')
    expect(window.scrollTo).not.toHaveBeenCalled()
  })

  it('주소를 바로 열어도(새로고침) 목록과 오른쪽 칸 상세다. 뒤로 가면 안내 문구로 돌아간다', async () => {
    put('2026-11', expense('김밥천국'))
    const opened = await openList()
    const [item] = list.months.get('2026-11')!
    await select(opened, '김밥천국')
    await opened.router.navigate(-1)
    expect(await screen.findByText(PLACEHOLDER)).toBeTruthy()
    expect(addressOf(opened)).toBe('/transactions?month=2026-11')
    cleanup()
    await openApp(`/transactions/${item.id}`)
    await waitFor(() => expect(paneTitle()).toBeTruthy())
    expect(await screen.findByRole('heading', { level: 1, name: '11월' })).toBeTruthy()
    await waitFor(() => expect(rowOf('김밥천국').getAttribute('aria-current')).toBe('page'))
  })

  it('창 폭이 1024px을 넘나들면 같은 주소를 그 폭의 배치로 보인다', async () => {
    put('2026-11', expense('김밥천국'))
    const opened = await openList()
    await select(opened, '김밥천국')
    window_.resizeTo(390)
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('거래 상세'))
    expect(screen.getByRole('button', { name: '뒤로' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '11월' })).toBeNull()
    window_.resizeTo(1280)
    await waitFor(() => expect(paneTitle()).toBeTruthy())
    expect(monthHeading().textContent).toBe('11월')
  })
})

describe('오른쪽 칸에서 삭제한 뒤', () => {
  async function deleteInPane(opened: Opened) {
    await opened.user.click(within(pane()!).getByRole('button', { name: '삭제' }))
    await untilOpened()
    const dialog = screen.getByRole('dialog', { name: '이 거래를 삭제할까요?' })
    await opened.user.click(within(dialog).getAllByRole('button', { name: '삭제' }).at(-1)!)
  }

  it.each([
    { label: '다음 줄', payees: ['김밥천국', '올래국수', '스타벅스'], chosen: '올래국수', focused: '스타벅스' },
    { label: '다음 줄이 없으면 이전 줄', payees: ['김밥천국', '올래국수'], chosen: '올래국수', focused: '김밥천국' },
  ])('안내 문구로 돌아가 그 줄이 빠지고 토스트를 보이며, 초점은 $label이다', async ({ payees, chosen, focused }) => {
    put('2026-11', ...payees.map((payee, index) => expense(payee, '2026-11-25', `1${9 - index}:00`)))
    const opened = await openList()
    await select(opened, chosen)
    await deleteInPane(opened)
    await waitFor(() => expect(addressOf(opened)).toBe('/transactions?month=2026-11'))
    expect(await screen.findByText(PLACEHOLDER)).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('link', { name: new RegExp(`^${chosen}`) })).toBeNull())
    await waitFor(() => expect(document.querySelector('[class*="region"]')!.textContent).toBe('휴지통으로 옮겼어요되돌리기'))
    expect(document.activeElement).toBe(rowOf(focused))
    expect(monthHeading().textContent).toBe('11월')
  })

  it('남은 줄이 없으면 초점은 목록 제목(달 이름)이다', async () => {
    put('2026-11', expense('김밥천국'))
    const opened = await openList()
    await select(opened, '김밥천국')
    await deleteInPane(opened)
    expect(await screen.findByText(PLACEHOLDER)).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('link', { name: /^김밥천국/ })).toBeNull())
    expect(document.activeElement).toBe(monthHeading())
  })
})

describe('넓은 화면의 거래 줄', () => {
  it('카테고리·계좌를 가맹점 옆에 두고, 가맹점이 길면 다음 줄로 내린다. 금액은 첫 줄 오른쪽 끝이다', async () => {
    put('2026-11', expense('김밥천국'))
    await openList()
    const title = rowOf('김밥천국').querySelector('[id$="-title"]')!
    const lead = title.parentElement!
    const detailText = lead.querySelector('[id$="-detail"]')!
    setViewportWidth(1280)
    expect([styleOf(lead).display, styleOf(lead).flexWrap]).toEqual(['flex', 'wrap'])
    expect(styleOf(title).flexGrow).toBe('0')
    expect(styleOf(detailText).order).toBe('0')
    expect(styleOf(lead.nextElementSibling!).marginInlineStart).toBe('auto')
  })

  it('휴대폰 배치는 지금처럼 둘째 줄이다', async () => {
    put('2026-11', expense('김밥천국'))
    await openList()
    const lead = rowOf('김밥천국').querySelector('[id$="-title"]')!.parentElement!
    setViewportWidth(390)
    expect(styleOf(lead).display).toBe('contents')
    expect(styleOf(lead.querySelector('[id$="-detail"]')!).order).toBe('1')
    expect(styleOf(lead.querySelector('[id$="-detail"]')!).flexBasis).toBe('100%')
  })
})

describe('계좌(G-01) 넓은 화면', () => {
  it('목록 칸 옆 오른쪽 칸에 "계좌를 고르면 여기에 자세히 보여요"를 둔다. 상단의 "추가"는 그대로다', async () => {
    await openApp('/accounts')
    expect(await screen.findByText('계좌를 고르면 여기에 자세히 보여요')).toBeTruthy()
    expect(main().children).toHaveLength(2)
    expect(screen.getByRole('heading', { level: 1, name: '계좌' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '추가' })).toBeTruthy()
  })

  it('휴대폰 배치는 한 칸이다', async () => {
    window_ = installMatchMedia(390)
    await openApp('/accounts')
    await screen.findByRole('heading', { level: 1, name: '계좌' })
    expect(screen.queryByText('계좌를 고르면 여기에 자세히 보여요')).toBeNull()
  })
})
