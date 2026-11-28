import { useQueryClient } from '@tanstack/react-query'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { useState, type ReactElement } from 'react'
import { Link, type RouteObject } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { accountOf, accountsBody, startAccounts, type Accounts } from './support/accounts'
import { delayed, ledgerIdOf, startBackend, type Backend } from './support/backend'
import { readCssRule } from './support/cssRule'
import { startMockServer } from './support/mockServer'
import { TRANSACTION_LIST_STALE_MS } from '../src/features/transactions/transactionListQueries'
import { addScreens, openApp } from './support/openApp'
import { problem } from './support/problem'
import { recordDom } from './support/recordDom'
import { holdClock, passTime, releaseClock } from './support/testClock'
import { resetViewport, setViewportWidth } from './support/viewport'
import { readWebFile } from './support/webFile'

const CSS = 'src/features/accounts/Accounts.module.css'
const empty = '계좌가 없어요. 계좌를 추가하면 잔액을 한눈에 볼 수 있어요.'
const loading = '불러오고 있어요.'
const failed = '불러오지 못했어요.'

const server = startMockServer()
const OTHER_LEDGER = '0e0e0e0e-0000-4000-8000-000000000002'
let backend: Backend
let accounts: Accounts

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn())
  backend = startBackend(server)
  backend.cookieUser = 'user-1'
  accounts = startAccounts(server, backend)
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  resetViewport()
  vi.unstubAllGlobals()
})

const salary = accountOf('급여통장', 'BANK', 3210000)
const saving = accountOf('비상금', 'BANK', 1000000)
const blueCard = accountOf('파란 카드', 'CARD', -482300)
const redCard = accountOf('빨간 카드', 'CARD', -130100)
const wallet = accountOf('지갑', 'CASH', 85000)
const everyType = [salary, saving, blueCard, redCard, wallet]

const main = () => screen.getByRole('main')
const content = () => within(main())
const texts = (elements: Element[]) => elements.map((element) => element.textContent)
const groupNames = () => texts(content().queryAllByRole('heading', { level: 2 }))
const group = (name: string) => content().getByRole('list', { name })
const rowsOf = (name: string) => texts(within(group(name)).getAllByRole('listitem'))
/** 묶음 이름과 같은 줄에 있는 묶음 합계 */
const headOf = (name: string) => content().getByRole('heading', { level: 2, name }).parentElement!
/** 묶음의 첫 계좌 줄. 줄 전체가 계좌 수정으로 가는 링크다(1B, #243) */
const firstRowOf = (name: string) => within(group(name)).getAllByRole('link')[0]
const totalRow = () => screen.getByText('자산 합계').parentElement!
const styleOf = (element: Element) => getComputedStyle(element)
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)))

/** 계좌 목록을 열고 불러오기가 끝날 때까지 기다린다. */
async function open(items: object[] = everyType) {
  accounts.items = items
  const opened = await openApp('/accounts')
  await screen.findByText(items.length > 0 ? '자산 합계' : empty)
  return opened
}

/** /accounts의 화면을 감싸 연다. 앱의 모듈이 필요하면 `wrap` 안에서 불러온다. */
async function openWrapped(wrap: (page: ReactElement) => Promise<ReactElement>) {
  async function change(route: RouteObject): Promise<RouteObject> {
    if (route.path === '/accounts') return { ...route, element: await wrap(route.element as ReactElement) } as RouteObject
    const children = route.children && (await Promise.all(route.children.map(change)))
    return { ...route, children } as RouteObject
  }
  return openApp('/accounts', (routes) => Promise.all(routes.map(change)))
}

describe('계좌 목록(G-01)', () => {
  it('공통 틀 안의 하위 화면이다. 제목은 "계좌" 하나이고 "뒤로"가 있다', async () => {
    await open()
    const bar = within(screen.getByRole('banner'))
    expect(bar.getByRole('button', { name: '뒤로' })).toBeTruthy()
    expect(texts(screen.getAllByRole('heading', { level: 1 }))).toEqual(['계좌'])
    expect(screen.getByRole('navigation', { name: '주 메뉴' })).toBeTruthy()
  })

  it('상단 바 오른쪽 끝에 계좌 추가로 가는 글자 버튼 "추가"가 있다', async () => {
    await open()
    const bar = screen.getByRole('banner')
    const link = within(bar).getByRole('link', { name: '추가' })
    expect(link.getAttribute('href')).toBe('/accounts/new')
    expect(bar.lastElementChild!.contains(link)).toBe(true)
    expect(styleOf(link).color).toBe('var(--color-accent)')
  })

  it('내용에서 누를 것은 계좌 줄(수정으로 가는 링크)뿐이다. 자산 합계와 묶음 머리는 누르지 않는다(#243)', async () => {
    await open()
    expect(content().queryAllByRole('button')).toEqual([])
    const links = content().queryAllByRole('link')
    expect(links).toHaveLength(everyType.length)
    expect(links.every((link) => link.parentElement!.tagName === 'LI')).toBe(true)
    expect(totalRow().closest('a')).toBeNull()
    expect(headOf('은행').closest('a')).toBeNull()
    // 줄에 화살표(>)를 두지 않는다(designer #243)
    expect(main().querySelector('[tabindex], [onclick], svg')).toBeNull()
  })

  it('주소를 바로 열었으면 "뒤로"가 더보기로 간다', async () => {
    window.history.replaceState(null, '', '/accounts')
    const { router, user } = await open()
    await user.click(screen.getByRole('button', { name: '뒤로' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/more'))
  })

  it('현재 장부의 계좌를 한 번 받는다', async () => {
    await open()
    await settle()
    expect(accounts.requests).toEqual([ledgerIdOf('user-1')])
  })

  it('맨 위에 자산 합계가 있고 값은 계좌별 잔액의 합이다', async () => {
    await open()
    expect(totalRow().textContent).toBe('자산 합계3,682,600원')
    expect(main().textContent!.startsWith('자산 합계')).toBe(true)
  })

  it('은행, 카드, 현금 순서의 묶음이고 머리에 묶음 합계가 있다', async () => {
    await open([wallet, redCard, salary, blueCard, saving])
    expect(groupNames()).toEqual(['은행', '카드', '현금'])
    expect(headOf('은행').textContent).toBe('은행4,210,000원')
    expect(headOf('카드').textContent).toBe('카드-612,400원')
    expect(headOf('현금').textContent).toBe('현금85,000원')
  })

  it('묶음 안은 서버가 준 순서다. 다시 정렬하지 않는다', async () => {
    const items = [
      accountOf('하나', 'BANK', 5),
      accountOf('카드', 'CARD', -1),
      accountOf('가나', 'BANK', 900),
      accountOf('다라', 'BANK', 70),
    ]
    await open(items)
    expect(rowsOf('은행')).toEqual(['하나5원', '가나900원', '다라70원'])
  })

  it('계좌 줄에는 이름과 잔액만 있다', async () => {
    await open()
    expect(rowsOf('은행')).toEqual(['급여통장3,210,000원', '비상금1,000,000원'])
    expect(rowsOf('카드')).toEqual(['파란 카드-482,300원', '빨간 카드-130,100원'])
    expect(rowsOf('현금')).toEqual(['지갑85,000원'])
  })

  it.each([
    ['은행만', [salary], ['은행']],
    ['카드만', [redCard], ['카드']],
    ['은행과 현금', [wallet, salary], ['은행', '현금']],
  ])('계좌가 없는 종류는 묶음째 없다: %s', async (_, items, names) => {
    await open(items)
    expect(groupNames()).toEqual(names)
    expect(content().getAllByRole('list')).toHaveLength(names.length)
  })

  it('합계가 음수이면 "-"를 붙이고 본문 글자색이다. 빨강을 쓰지 않는다', async () => {
    await open([wallet, blueCard])
    expect(totalRow().textContent).toBe('자산 합계-397,300원')
    for (const text of ['-397,300원', '85,000원']) {
      expect(styleOf(content().getAllByText(text)[0]).color).toBe('var(--color-text)')
    }
    for (const amount of content().getAllByText('-482,300원')) {
      expect(styleOf(amount).color).toBe('var(--color-text)')
    }
    expect(readWebFile(CSS)).not.toContain('danger')
  })

  it('합계가 0이면 "0원"이다', async () => {
    await open([accountOf('지갑', 'CASH', 5000), accountOf('카드', 'CARD', -5000)])
    expect(totalRow().textContent).toBe('자산 합계0원')
  })

  it('금액은 줄이지 않고 숫자 폭이 같다', async () => {
    await open([accountOf('지갑', 'CASH', 9999999999), accountOf('카드', 'CARD', -9999999999)])
    expect(rowsOf('현금')).toEqual(['지갑9,999,999,999원'])
    expect(rowsOf('카드')).toEqual(['카드-9,999,999,999원'])
    for (const amount of content().getAllByText(/원$/)) expect(amount.classList.contains('tabular-nums')).toBe(true)
  })

  it('긴 이름도 글자를 자르지 않고, 글자로만 그린다', async () => {
    const long = '<b>이름이 아주 길어서 한 줄에 다 들어가지 않는 생활비 통장</b>'
    await open([accountOf(long, 'BANK', 1)])
    expect(content().getByText(long)).toBeTruthy()
    expect(main().querySelector('b')).toBeNull()
  })

  it('로그인하지 않았으면 로그인 화면으로 보내고 로그인하면 돌아온다', async () => {
    backend.cookieUser = undefined
    accounts.items = everyType
    const { router, user } = await openApp('/accounts')
    await user.type(await screen.findByLabelText('이메일'), 'name@example.com')
    await user.type(screen.getByLabelText('비밀번호'), 'pass1234')
    await user.click(screen.getByRole('button', { name: '로그인' }))
    expect(await screen.findByText('자산 합계')).toBeTruthy()
    expect(router.state.location.pathname).toBe('/accounts')
  })
})

describe('계좌 목록의 모양', () => {
  it('자산 합계 줄은 위아래 24px이고 이름은 본문, 금액은 제목 크기다', async () => {
    await open()
    expect(styleOf(totalRow()).getPropertyValue('padding-block')).toBe('var(--space-24)')
    const [name, amount] = totalRow().children
    expect(styleOf(name).font).toBe('var(--text-body)')
    expect(styleOf(amount).font).toBe('var(--text-title)')
  })

  it('묶음 머리는 이름이 라벨 크기의 본문 글자색, 합계가 굵은 본문이고 아래가 8px이다. 최소 높이가 없다', async () => {
    await open()
    const head = headOf('은행')
    const [name, amount] = head.children
    expect(styleOf(name).font).toBe('var(--text-label)')
    expect(styleOf(name).color).not.toBe('var(--color-text-secondary)')
    expect(styleOf(amount).font).toBe('var(--text-body-strong)')
    expect(styleOf(head).paddingBottom).toBe('var(--space-8)')
    expect(styleOf(head).minHeight).not.toBe('var(--size-row)')
  })

  it('계좌 줄은 높이 56px 이상이고 이름은 본문, 잔액은 굵은 본문이다', async () => {
    await open()
    const row = firstRowOf('은행')
    expect(styleOf(row).minHeight).toBe('var(--size-row)')
    expect(styleOf(row).alignContent).toBe('center')
    const [name, amount] = row.children
    expect(styleOf(name).font).toBe('var(--text-body)')
    expect(styleOf(amount).font).toBe('var(--text-body-strong)')
  })

  it('계좌 줄은 누르면 눌림 바탕이고 올림 바탕은 마우스가 있을 때만이며, 글자는 본문색에 밑줄이 없다. 줄 사이 선은 없다', async () => {
    await open()
    const css = readWebFile(CSS)
    expect(readCssRule(CSS, '.link:active')).toContain('background-color: var(--color-press)')
    expect(css).toMatch(/@media \(hover: hover\) \{\s*\.link:hover \{\s*background-color: var\(--color-press\);/)
    expect(css.match(/:hover|:active/g)).toEqual([':active', ':hover'])
    expect(styleOf(firstRowOf('은행')).color).toBe('var(--color-text)')
    expect(styleOf(firstRowOf('은행')).textDecoration).toBe('none')
    expect(css).not.toMatch(/cursor|box-shadow|border-radius/)
    expect(css.match(/border[\w-]*:/g)).toEqual(['border-top:'])
  })

  it('휴대폰에서는 줄이 화면 끝까지 닿아 초점 표시를 안쪽에 그리고, 내용 폭 배치(768px 이상)에서는 바깥에 그린다', async () => {
    await open()
    expect(readCssRule(CSS, '.link:focus-visible')).toContain('outline-offset: calc(-1 * var(--focus-ring-width))')
    expect(readWebFile(CSS)).toMatch(
      /@media \(width >= 768px\) \{\s*\.link:focus-visible \{\s*outline-offset: var\(--focus-ring-offset\);/,
    )
  })

  it('묶음마다 위에 1px 선을 긋고 선 위아래는 24px이다', async () => {
    await open()
    const [bank, card] = ['은행', '카드'].map((name) => headOf(name).parentElement!)
    expect(readCssRule(CSS, '.group')).toContain('border-top: 1px solid var(--color-border)')
    expect(styleOf(bank).paddingTop).toBe('var(--space-24)')
    // 첫 묶음 위는 자산 합계 줄의 아래 안쪽 24px이다
    expect(styleOf(bank).marginTop).not.toBe('var(--space-24)')
    expect(styleOf(card).marginTop).toBe('var(--space-24)')
  })

  it.each([320, 390, 767])('폭 %dpx에서는 선이 화면 끝까지 닿고 글은 좌우 16px 안에 있다', async (width) => {
    await open()
    setViewportWidth(width)
    expect(styleOf(totalRow().parentElement!).getPropertyValue('--bleed')).toBe('var(--space-16)')
    expect(styleOf(totalRow().parentElement!).getPropertyValue('margin-inline')).toBe('calc(-1 * var(--bleed))')
    expect(styleOf(totalRow()).getPropertyValue('padding-inline')).toBe('var(--bleed)')
  })

  it.each([768, 1024, 1280])('폭 %dpx에서는 선과 글이 가운데 내용 폭에 맞는다', async (width) => {
    await open()
    setViewportWidth(width)
    expect(styleOf(totalRow().parentElement!).getPropertyValue('--bleed')).toBe('0px')
  })

  it('이름은 줄을 바꾸고 줄임표를 쓰지 않는다. 띄어쓰기가 없어도 칸 안에서 줄을 바꾼다', async () => {
    await open()
    for (const row of [totalRow(), headOf('은행'), firstRowOf('은행')]) {
      const name = styleOf(row.children[0])
      expect(name.getPropertyValue('overflow-wrap')).toBe('anywhere')
      expect(name.textOverflow).not.toBe('ellipsis')
      expect(name.overflow).not.toBe('hidden')
      expect(name.whiteSpace).not.toBe('nowrap')
    }
  })

  it('금액은 이름의 첫 줄에 맞추고, 이름 자리가 줄의 절반보다 좁아지면 다음 줄 오른쪽으로 내린다', async () => {
    await open()
    for (const row of [totalRow(), headOf('은행'), firstRowOf('은행')]) {
      expect(styleOf(row).display).toBe('flex')
      expect(styleOf(row).flexWrap).toBe('wrap')
      expect(styleOf(row).alignItems).toBe('baseline')
      const [name, amount] = row.children
      expect(styleOf(name).flex).toBe('1 1 50%')
      expect(styleOf(name).minWidth).toBe('0px')
      expect(styleOf(amount).getPropertyValue('margin-inline-start')).toBe('auto')
    }
  })

  it('금액은 줄 폭을 넘지 않고, 줄 폭보다 길면 오른쪽에 맞춰 줄을 바꾼다', async () => {
    await open()
    for (const row of [totalRow(), headOf('은행'), firstRowOf('은행')]) {
      const amount = styleOf(row.children[1])
      expect(amount.flex).toBe('0 1 auto')
      expect(amount.textAlign).toBe('end')
    }
  })

  it('계좌 줄은 여러 줄이면 위아래 안쪽 8px을 지키고 커진다', async () => {
    await open()
    const row = firstRowOf('은행')
    expect(styleOf(row).getPropertyValue('padding-block')).toBe('var(--space-8)')
    expect(styleOf(row).height).toBe('auto')
    expect(styleOf(row).maxHeight).toBe('none')
  })
})

describe('계좌가 없으면', () => {
  it('설명과 주 버튼 "계좌 추가"만 보이고 자산 합계와 묶음이 없다', async () => {
    await open([])
    expect(main().textContent).toBe(`${empty}계좌 추가`)
    expect(content().queryAllByRole('list')).toEqual([])
    expect(content().queryAllByRole('heading')).toEqual([])
    const link = content().getByRole('link', { name: '계좌 추가' })
    expect(link.getAttribute('href')).toBe('/accounts/new')
    expect(styleOf(link).backgroundColor).toBe('var(--color-accent)')
  })

  it('상단 바의 "추가"도 그대로 있다', async () => {
    await open([])
    expect(within(screen.getByRole('banner')).getByRole('link', { name: '추가' })).toBeTruthy()
  })
})

describe('불러오는 중', () => {
  const pass = passTime

  /** 다른 화면에서 시계를 멈추고 계좌 목록으로 간다. 계좌 요청은 답을 기다린다. */
  async function openLoading() {
    const answer = delayed()
    accounts.response = answer.respond
    const { router } = await openApp('/other', addScreens([{ path: '/other', element: <main>다른 화면</main> }]))
    await screen.findByText('다른 화면')
    holdClock()
    await act(() => router.navigate('/accounts'))
    return answer
  }

  const skeleton = () => main().querySelector('[aria-hidden="true"]')!

  it('300ms까지는 빈 자리이고 그 뒤 뼈대를 보이며 "불러오고 있어요."를 알린다', async () => {
    await openLoading()
    const status = content().getByRole('status')
    await pass(299)
    expect(main().textContent).toBe('')
    expect(skeleton()).toBeNull()
    await pass(1)
    expect(content().getByRole('status')).toBe(status)
    expect(main().textContent).toBe(loading)
    expect(skeleton()).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: '계좌' })).toBeTruthy()
  })

  it('뼈대는 자산 합계 한 줄, 묶음 머리 3개, 묶음마다 계좌 줄 2개이고 화면 읽기에는 없다', async () => {
    await openLoading()
    await pass(300)
    const [total, ...groups] = [...skeleton().firstElementChild!.children]
    expect(total.children).toHaveLength(2)
    expect(groups.map((each) => [...each.children].map((row) => row.children.length))).toEqual([
      [2, 2, 2],
      [2, 2, 2],
      [2, 2, 2],
    ])
    expect(content().queryAllByRole('listitem')).toEqual([])
    expect(content().queryAllByRole('heading')).toEqual([])
  })

  it('줄과 묶음이 실제와 같은 CSS를 쓰고, 막대가 글자와 같은 높이의 자리를 차지한다', async () => {
    const answer = await openLoading()
    await pass(300)
    const read = (element: Element) => element.className
    const fontsOf = (row: Element) => [...row.children].map((cell) => styleOf(cell).font)
    const list = skeleton().firstElementChild!
    const [total, bank] = list.children
    const [head, row] = bank.children
    const classes = [list, total, bank, head, row].map(read)
    const fonts = [total, head, row].map(fontsOf)

    answer.answer(accountsBody(...everyType))
    releaseClock()
    await screen.findByText('자산 합계')
    const realRows = [totalRow(), headOf('은행'), firstRowOf('은행')]
    const realParts = [totalRow().parentElement!, realRows[0], headOf('은행').parentElement!, realRows[1], realRows[2]]
    // 계좌 줄의 링크 모양(눌림, 초점)은 뼈대에 없다
    const withoutLink = (classes: string) => classes.replace(/ \S*_link_\S*/, '')
    expect(classes).toEqual(realParts.map(read).map(withoutLink))
    // 굵기만 다른 본문 두 글자 토큰은 줄 높이가 같다
    const sameHeight = (font: string) => font.replace('-strong', '')
    expect(fonts.flat()).toEqual(realRows.map(fontsOf).flat().map(sameHeight))
  })

  it('받으면 뼈대와 알림을 지우고 내용을 보인다', async () => {
    const answer = await openLoading()
    await pass(300)
    answer.answer(accountsBody(...everyType))
    releaseClock()
    await screen.findByText('자산 합계')
    expect(content().queryByRole('status')).toBeNull()
    expect(main().querySelector('[aria-hidden="true"]')).toBeNull()
  })

  it('300ms 안에 받으면 뼈대를 보이지 않는다', async () => {
    const answer = await openLoading()
    const dom = recordDom()
    answer.answer(accountsBody(...everyType))
    releaseClock()
    await screen.findByText('자산 합계')
    expect(dom.sawText(loading)).toBe(false)
    expect(dom.sawElement('[aria-hidden="true"]')).toBe(false)
  })
})

describe('불러오지 못하면', () => {
  const failure = () => screen.findByRole('heading', { level: 2, name: failed })
  const retryButton = () => content().getByRole('button', { name: '다시 시도' })

  it.each([
    ['서버 오류', () => problem(500, 'INTERNAL_ERROR')],
    ['없는 장부', () => problem(404, 'NOT_FOUND')],
    ['모르는 종류가 섞인 응답', () => accountsBody(salary, accountOf('대출', 'LOAN', -1))],
    ['정수가 아닌 잔액', () => accountsBody(salary, accountOf('지갑', 'CASH', 0.1))],
    ['모양이 다른 응답', () => HttpResponse.json([salary])],
  ])('%s: 목록 대신 오류와 "다시 시도"만 보이고 제목(h1)은 "계좌" 하나다', async (_, respond) => {
    accounts.response = respond
    const consoleError = vi.spyOn(console, 'error')
    const dom = recordDom()
    await openApp('/accounts')
    await failure()
    expect(main().textContent).toBe(`${failed}잠시 후 다시 시도해 주세요.다시 시도`)
    expect(texts(screen.getAllByRole('heading', { level: 1 }))).toEqual(['계좌'])
    expect(dom.sawText('급여통장')).toBe(false)
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('연결 오류이고 기기에 남긴 계좌 목록이 없으면 버튼 없이 "연결되면 자동으로 불러올게요."다(F-908, #238)', async () => {
    accounts.response = () => HttpResponse.error()
    await openApp('/accounts')
    await failure()
    expect(main().textContent).toBe(`${failed}연결되면 자동으로 불러올게요.`)
    expect(content().queryByRole('button')).toBeNull()
    expect(texts(screen.getAllByRole('heading', { level: 1 }))).toEqual(['계좌'])
  })

  it('"다시 시도"를 누르면 화면은 그대로 두고 그 버튼만 처리 중이며, 받으면 목록을 보인다', async () => {
    accounts.response = () => problem(500, 'INTERNAL_ERROR')
    const { user } = await openApp('/accounts')
    const heading = await failure()
    const answer = delayed()
    accounts.response = answer.respond
    await user.click(retryButton())
    await answer.arrived
    await settle()
    expect(await failure()).toBe(heading)
    expect(retryButton().getAttribute('aria-busy')).toBe('true')
    await user.click(retryButton())
    expect(accounts.requests).toHaveLength(2)

    answer.answer(accountsBody(...everyType))
    expect(await screen.findByText('자산 합계')).toBeTruthy()
    expect(screen.queryByText(failed)).toBeNull()
  })

  it('또 실패하면 버튼이 되돌아온다', async () => {
    accounts.response = () => problem(500, 'INTERNAL_ERROR')
    const { user } = await openApp('/accounts')
    await failure()
    await user.click(retryButton())
    await waitFor(() => expect(accounts.requests).toHaveLength(2))
    await waitFor(() => expect(retryButton().hasAttribute('aria-busy')).toBe(false))
  })

  it('저절로 다시 받지 않는다', async () => {
    accounts.response = () => problem(500, 'INTERNAL_ERROR')
    await openApp('/accounts')
    await failure()
    await settle()
    expect(accounts.requests).toHaveLength(1)
  })

  it('다른 화면에 다녀와 다시 받는 동안에는 앞의 오류를 보이지 않는다', async () => {
    accounts.response = () => problem(500, 'INTERNAL_ERROR')
    const { router } = await openApp('/accounts', addScreens([{ path: '/other', element: <main>다른 화면</main> }]))
    await failure()
    await act(() => router.navigate('/other'))
    const answer = delayed()
    accounts.response = answer.respond
    await act(() => router.navigate('/accounts'))
    await answer.arrived
    expect(screen.queryByText(failed)).toBeNull()
    expect(await screen.findByText(loading)).toBeTruthy()
    answer.answer(accountsBody(...everyType))
    expect(await screen.findByText('자산 합계')).toBeTruthy()
  })
})

describe('이미 불러온 뒤', () => {
  /** 탭으로 돌아온 것을 알린다. 받은 지 30초가 지났으면 쓰던 값을 다시 받는다. */
  const refocus = () => act(() => window.dispatchEvent(new Event('visibilitychange')))
  /** 받은 목록을 새것으로 보는 30초(perf 권고 #90)가 지난 것으로 한다. 라이브러리가 재는 시계(Date)도 공용 시계다. */
  const passStaleTime = () => passTime(TRANSACTION_LIST_STALE_MS + 1)

  it('30초 안에는 탭에 돌아오거나 다른 화면에 다녀와도 다시 받지 않는다', async () => {
    accounts.items = everyType
    const { router } = await openApp(
      '/accounts',
      addScreens([{ path: '/other', element: <Link to="/accounts">계좌로</Link> }]),
    )
    await screen.findByText('자산 합계')
    await refocus()
    await act(() => router.navigate('/other'))
    await act(() => router.navigate('/accounts'))
    await settle()
    expect(totalRow().textContent).toBe('자산 합계3,682,600원')
    expect(accounts.requests).toHaveLength(1)
  })

  it('30초가 지나 다시 불러오기가 실패하면 있던 내용을 그대로 보인다', async () => {
    await open()
    accounts.response = () => problem(500, 'INTERNAL_ERROR')
    await passStaleTime()
    await refocus()
    await waitFor(() => expect(accounts.requests).toHaveLength(2))
    await settle()
    expect(rowsOf('은행')).toEqual(['급여통장3,210,000원', '비상금1,000,000원'])
    expect(screen.queryByText(failed)).toBeNull()
    expect(content().queryByRole('button')).toBeNull()
    expect(totalRow().previousElementSibling!.textContent).toBe('12:00 기준')
  })

  it('30초가 지나 다시 불러온 것이 약속과 달라도 있던 내용을 그대로 보인다', async () => {
    await open()
    accounts.response = () => accountsBody(accountOf('대출', 'LOAN', -1))
    await passStaleTime()
    await refocus()
    await waitFor(() => expect(accounts.requests).toHaveLength(2))
    await settle()
    // 새로 불러오지 못했으므로 그 값을 받은 시각을 붙인다(N-03 (5), #238)
    expect(totalRow().textContent).toBe('자산 합계3,682,600원')
    expect(totalRow().previousElementSibling!.textContent).toBe('12:00 기준')
  })

  it('30초가 지나 다시 불러오는 동안 뼈대로 바꾸지 않고, 받으면 합계를 다시 계산한다', async () => {
    await open()
    const answer = delayed()
    accounts.response = answer.respond
    await passStaleTime()
    await refocus()
    await answer.arrived
    await passTime(350)
    expect(totalRow().textContent).toBe('자산 합계3,682,600원')
    expect(content().queryByRole('status')).toBeNull()
    answer.answer(accountsBody(wallet))
    await waitFor(() => expect(totalRow().textContent).toBe('자산 합계85,000원'))
    expect(groupNames()).toEqual(['현금'])
  })

  it('30초가 지나 다른 화면에 다녀오면 받아 둔 목록을 바로 보이고 다시 받는다', async () => {
    accounts.items = everyType
    const { router } = await openApp(
      '/accounts',
      addScreens([{ path: '/other', element: <Link to="/accounts">계좌로</Link> }]),
    )
    await screen.findByText('자산 합계')
    await act(() => router.navigate('/other'))
    await passStaleTime()
    const answer = delayed()
    accounts.response = answer.respond
    await act(() => router.navigate('/accounts'))
    expect(totalRow().textContent).toBe('자산 합계3,682,600원')
    await answer.arrived
    expect(accounts.requests).toHaveLength(2)
  })

  it('뒤 화면의 저장이 이 장부의 계좌를 무효로 만들면 다시 받는다', async () => {
    accounts.items = everyType
    const { user } = await openWrapped(async (page) => {
      const { accountsKey } = await import('../src/features/accounts/useAccounts')
      function WithSave() {
        const queryClient = useQueryClient()
        const save = () => void queryClient.invalidateQueries({ queryKey: accountsKey(ledgerIdOf('user-1')) })
        return (
          <>
            {page}
            <button type="button" onClick={save}>
              저장
            </button>
          </>
        )
      }
      return <WithSave />
    })
    await screen.findByText('자산 합계')
    accounts.items = [wallet]
    await user.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(totalRow().textContent).toBe('자산 합계85,000원'))
    expect(accounts.requests).toHaveLength(2)
  })

  it('장부가 바뀌면 따로 받고 앞 장부의 계좌를 보이지 않는다', async () => {
    accounts.items = [salary]
    const { user } = await openWrapped(async (page) => {
      const { CurrentLedgerContext, useCurrentLedger } = await import('../src/features/me/CurrentLedgerContext')
      const other = { id: OTHER_LEDGER, name: '다른 장부', role: 'OWNER' }
      function WithLedgers() {
        const first = useCurrentLedger()
        const [ledger, setLedger] = useState(first)
        return (
          <>
            <CurrentLedgerContext value={ledger}>{page}</CurrentLedgerContext>
            <button type="button" onClick={() => setLedger(other)}>
              장부 바꾸기
            </button>
          </>
        )
      }
      return <WithLedgers />
    })
    await screen.findByText('급여통장')
    const answer = delayed()
    accounts.response = answer.respond
    await user.click(screen.getByRole('button', { name: '장부 바꾸기' }))
    expect(screen.queryByText('급여통장')).toBeNull()
    answer.answer(accountsBody(wallet))
    await screen.findByText('지갑')
    expect(accounts.requests).toEqual([ledgerIdOf('user-1'), OTHER_LEDGER])
  })
})
