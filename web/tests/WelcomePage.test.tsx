import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Button } from '../src/components/Button'
import StatusChip from '../src/components/StatusChip'
import { accountOf, startAccounts, type Accounts } from './support/accounts'
import { delayed, startBackend, type Backend } from './support/backend'
import { categoryOf, defaultExpenses, defaultIncomes, startCategories, type Categories } from './support/categories'
import { readCssRule } from './support/cssRule'
import { readWebFile } from './support/webFile'
import { untilOpened } from './support/dialog'
import { startMockServer } from './support/mockServer'
import { openApp } from './support/openApp'
import { problem } from './support/problem'
import { recordDom } from './support/recordDom'
import { installMatchMedia, resetViewport, setViewportWidth } from './support/viewport'
import { createFakeLocks, installLocks, removeLocks } from './support/webLocks'

const CSS = 'src/features/welcome/Welcome.module.css'
const firstTitle = '기본 카테고리를 넣어 두었어요'
const secondTitle = '첫 계좌를 만들어 주세요'
const note = '카테고리는 나중에 카테고리 관리에서 고칠 수 있어요.'
const description = '자주 쓰는 통장이나 카드 하나면 돼요. 나머지는 나중에 더할 수 있어요.'
const skipNote = '"현금" 계좌를 만들고 시작해요.'
const loading = '불러오고 있어요.'
const loadFailed = '불러오지 못했어요.'
const failed = '문제가 생겨 계좌를 만들지 못했어요. 잠시 후 다시 시도해 주세요.'
const typeNotice = '종류를 바꾸면 금액의 뜻이 바뀌어요. 금액을 다시 확인해 주세요.'

// C-02의 입력값 오류(#84). 계좌 추가(G-02)와 다른 문구가 있다
const nameRequired = '계좌 이름을 입력해 주세요'
const nameTooLong = '50자까지 쓸 수 있어요'
const nameUnusable = '쓸 수 없는 글자가 있어요. 모두 지우고 다시 써 주세요.'
const nameDuplicate = '같은 이름의 계좌가 있어요'
const typeRequired = '종류를 골라 주세요'
const amountRequired = '금액을 입력해 주세요. 없으면 0을 적어요.'
const amountTooLarge = '9,999,999,999원까지 입력할 수 있어요.'
const dateRequired = '기준일을 골라 주세요'
const dateOutOfRange = '2000년 1월 1일부터 2027년 11월 26일까지 고를 수 있어요.'

const server = startMockServer()
let backend: Backend
let accounts: Accounts
let categories: Categories

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 26, 12) })
  vi.stubGlobal('scrollTo', vi.fn())
  installMatchMedia(390)
  installLocks(createFakeLocks())
  backend = startBackend(server)
  backend.cookieUser = 'user-1'
  accounts = startAccounts(server, backend)
  categories = startCategories(server, backend)
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  cleanup()
  resetViewport()
  removeLocks()
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

type Opened = Awaited<ReturnType<typeof openApp>>
type User = Opened['user']

const firstHeading = () => screen.findByRole('heading', { level: 1, name: firstTitle })
const secondHeading = () => screen.findByRole('heading', { level: 1, name: secondTitle })
const nextButton = () => screen.getByRole('button', { name: '다음' })
const name = () => screen.getByLabelText<HTMLInputElement>('계좌 이름')
const type = (label: string) => screen.getByRole('radio', { name: label })
const typeGroup = () => screen.getByRole('radiogroup', { name: '종류' })
const balance = () => screen.getByLabelText<HTMLInputElement>('시작 잔액')
const owed = () => screen.getByLabelText<HTMLInputElement>('지금 갚을 금액')
const sign = () => screen.getByRole('button', { name: '마이너스' })
const date = () => screen.getByRole<HTMLButtonElement>('button', { name: /^기준일/ })
const createButton = () => screen.getByRole('button', { name: '계좌 만들기' })
const skipButton = () => screen.getByRole('button', { name: '건너뛰기' })
const retryButton = () => screen.getByRole('button', { name: '다시 시도' })
const chipsOf = (kind: string) =>
  within(screen.getByRole('list', { name: kind }))
    .getAllByRole('listitem')
    .map((item) => item.textContent)
const settle = (ms = 50) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))
const path = ({ router }: Opened) => router.state.location.pathname + router.state.location.search
const home = () => screen.findByRole('heading', { level: 1, name: '찾을 수 없어요.' })
const toast = () => screen.getAllByRole('status').find((region) => region.textContent !== '')?.textContent

/** 칸 아래에 이어진 오류 문구. 없으면 없다. */
function errorOf(control: HTMLElement): string | undefined {
  const ids = control.getAttribute('aria-describedby')?.split(' ') ?? []
  const message = ids.map((id) => document.getElementById(id)!).find((element) => element.querySelector('svg'))
  return message?.textContent
}

const controls = () => [name(), typeGroup(), screen.getByRole('textbox', { name: / 원$/ }), date()]
const errors = () => controls().map(errorOf)

/** 첫 장을 열고 카테고리를 받을 때까지 기다린다. */
async function openFirst(address = '/welcome') {
  const opened = await openApp(address)
  await firstHeading()
  await screen.findByRole('list', { name: '지출' })
  return opened
}

/** 첫 장에서 "다음"을 눌러 둘째 장을 연다. */
async function openSecond() {
  const opened = await openFirst()
  await opened.user.click(nextButton())
  await secondHeading()
  return opened
}

async function fill(user: User, { name: typed = '국민은행 통장', amount = '350000' } = {}) {
  await user.click(name())
  await user.paste(typed)
  await user.click(balance())
  await user.keyboard(amount)
}

const refuse =
  (...fieldErrors: [field: string, code: string][]) =>
  () =>
    problem(400, 'VALIDATION_FAILED', {
      fieldErrors: fieldErrors.map(([field, code]) => ({ field, code, message: '개발자가 읽는 글' })),
    })

const created = () => accounts.added.map(({ body }) => body)

describe('첫 장(1/2)', () => {
  it('공통 틀 없이 진행 표시, 제목, 지출과 수입의 기본 카테고리, 안내, "다음"이 위에서부터 놓인다', async () => {
    await openFirst()
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.queryByRole('banner')).toBeNull()
    expect(screen.getAllByRole('main')).toHaveLength(1)
    const all = [...document.querySelectorAll('*')]
    const parts = [
      screen.getByText('1/2'),
      screen.getByRole('heading', { level: 1 }),
      screen.getByRole('heading', { level: 2, name: '지출' }),
      screen.getByRole('list', { name: '지출' }),
      screen.getByRole('heading', { level: 2, name: '수입' }),
      screen.getByRole('list', { name: '수입' }),
      screen.getByText(note),
      nextButton(),
    ]
    const positions = parts.map((part) => all.indexOf(part))
    expect(positions).toEqual(positions.toSorted((a, b) => a - b))
  })

  it('진행 표시는 "1/2"이고 화면 읽기에는 "2장 중 1장"으로 읽힌다', async () => {
    await openFirst()
    expect(screen.getByText('1/2').getAttribute('aria-hidden')).toBe('true')
    const spoken = screen.getByText('2장 중 1장')
    expect(spoken.closest('[aria-hidden]')).toBeNull()
    const progress = spoken.parentElement!
    expect(progress).toBe(screen.getByText('1/2').parentElement)
    expect(getComputedStyle(progress).font).toBe('var(--text-caption)')
    expect(getComputedStyle(progress).color).toBe('var(--color-text-secondary)')
    expect(getComputedStyle(spoken).getPropertyValue('clip-path')).toBe('inset(50%)')
  })

  it('서버의 최상위 카테고리를 구분별로 서버 순서대로 칩으로 보인다. 미분류도 있다', async () => {
    await openFirst()
    expect(chipsOf('지출')).toEqual(defaultExpenses)
    expect(chipsOf('수입')).toEqual(defaultIncomes)
  })

  it('하위 카테고리는 보이지 않고, 서버가 준 순서를 다시 정렬하지 않는다', async () => {
    categories.items = [
      { ...categoryOf('EXPENSE', '식비'), children: [{ id: 'eat-out', name: '외식' }] },
      categoryOf('EXPENSE', '미분류', true),
      categoryOf('EXPENSE', '교통'),
      categoryOf('INCOME', '급여'),
    ]
    await openFirst()
    expect(chipsOf('지출')).toEqual(['식비', '미분류', '교통'])
    expect(chipsOf('수입')).toEqual(['급여'])
    expect(screen.queryByText('외식')).toBeNull()
  })

  it('다른 구성원이 지워 미분류만 남았으면 미분류 칩만 보인다', async () => {
    categories.items = [categoryOf('EXPENSE', '미분류', true), categoryOf('INCOME', '미분류', true)]
    await openFirst()
    expect(chipsOf('지출')).toEqual(['미분류'])
    expect(chipsOf('수입')).toEqual(['미분류'])
  })

  it('칩은 표시 칩(StatusChip) 그대로이고 누를 수 없다', async () => {
    await openFirst()
    const chip = within(screen.getByRole('list', { name: '지출' })).getByText('식비')
    const { container } = render(<StatusChip>식비</StatusChip>)
    expect(chip.className).toBe(container.firstElementChild!.className)
    expect(chip.tagName).toBe('SPAN')
    const lists = screen.getAllByRole('list')
    expect(lists.flatMap((list) => within(list).queryAllByRole('button'))).toEqual([])
    expect(lists.flatMap((list) => within(list).queryAllByRole('link'))).toEqual([])
    expect(chip.closest('[tabindex]')).toBeNull()
  })

  it('"다음"은 주 버튼이고 누르면 /welcome?step=2로 쌓아 간다', async () => {
    const opened = await openFirst()
    expect(nextButton().className).toBe(primaryClass())
    await opened.user.click(nextButton())
    await secondHeading()
    expect(path(opened)).toBe('/welcome?step=2')
    expect(opened.router.state.historyAction).toBe('PUSH')
  })

  it('카테고리를 다시 받지 않고 다음 장으로 간다', async () => {
    const opened = await openFirst()
    await opened.user.click(nextButton())
    await secondHeading()
    expect(categories.requests).toEqual(['user-1-ledger'])
  })
})

/** 주 버튼의 모양. 다른 화면의 주 버튼과 같다. */
function primaryClass(): string {
  const { container } = render(<Button kind="primary">주</Button>)
  const className = container.querySelector('button')!.className
  container.remove()
  return className
}

describe('첫 장을 불러오는 중', () => {
  const pass = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))
  // 진행 표시의 "1/2"(span)도 화면 읽기에서 감춘 것이라 뼈대 자리(div)만 고른다
  const skeletons = () => [...document.querySelectorAll('main div[aria-hidden="true"]')]

  /** 둘째 장에서 시계를 멈추고 첫 장으로 간다. 카테고리 요청은 답을 기다린다. */
  async function openLoading() {
    const answer = delayed()
    categories.response = answer.respond
    const opened = await openApp('/welcome?step=2')
    await secondHeading()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: new Date(2026, 10, 26, 12) })
    await act(() => opened.router.navigate('/welcome'))
    return { ...opened, answer }
  }

  it('소제목과 안내, "다음"은 바로 보이고 칩 자리는 300ms까지 비어 있다가 뼈대를 보인다', async () => {
    await openLoading()
    expect(screen.getByRole('heading', { level: 1, name: firstTitle })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: '지출' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: '수입' })).toBeTruthy()
    expect(screen.getByText(note)).toBeTruthy()
    expect(nextButton()).toBeTruthy()
    await pass(299)
    expect(skeletons()).toHaveLength(2)
    expect(skeletons().every((part) => getComputedStyle(part).visibility === 'hidden')).toBe(true)
    expect(screen.queryByText(loading)).toBeNull()
    await pass(1)
    expect(skeletons().every((part) => getComputedStyle(part).visibility !== 'hidden')).toBe(true)
    expect(screen.getByText(loading)).toBeTruthy()
  })

  it('뼈대는 묶음마다 64x24 완전히 둥근 막대 다섯 개씩 두 줄이고, 300ms 전에도 같은 자리를 차지해 밀리지 않는다', async () => {
    const { answer } = await openLoading()
    const hidden = skeletons().map((part) => part.innerHTML)
    expect(hidden).toHaveLength(2)
    await pass(300)
    const shown = skeletons()
    expect(shown.map((part) => part.innerHTML)).toEqual(hidden)
    for (const part of shown) {
      const bars = part.querySelectorAll('span')
      expect(bars).toHaveLength(10)
      const grid = getComputedStyle(bars[0].parentElement!)
      expect(grid.display).toBe('grid')
      expect(grid.gridTemplateColumns).toBe('repeat(5, minmax(0, calc(2 * var(--space-32))))')
      expect(grid.gap).toBe('var(--space-8)')
      const bar = getComputedStyle(bars[0])
      expect(bar.height).toBe('var(--size-chip)')
      expect(bar.borderRadius).toBe('var(--radius-full)')
      expect(bar.backgroundColor).toBe('var(--color-border)')
    }
    answer.answer(HttpResponse.json({ items: [] }))
  })

  it('"불러오고 있어요."는 화면 읽기에 한 번만 알리고 뼈대는 읽히지 않는다', async () => {
    await openLoading()
    await pass(300)
    const statuses = screen.getAllByRole('status').filter((region) => region.textContent === loading)
    expect(statuses).toHaveLength(1)
    expect(within(screen.getByRole('main')).queryAllByRole('listitem')).toEqual([])
  })

  it('받으면 뼈대와 알림을 지우고 칩을 보인다', async () => {
    const { answer } = await openLoading()
    await pass(300)
    answer.answer(HttpResponse.json({ items: [categoryOf('EXPENSE', '식비'), categoryOf('INCOME', '급여')] }))
    vi.useRealTimers()
    await screen.findByText('식비')
    expect(skeletons()).toEqual([])
    expect(screen.queryByText(loading)).toBeNull()
  })

  it('300ms 안에 받으면 뼈대를 보이지 않는다', async () => {
    const { answer } = await openLoading()
    const dom = recordDom()
    answer.answer(HttpResponse.json({ items: [categoryOf('EXPENSE', '식비')] }))
    vi.useRealTimers()
    await screen.findByText('식비')
    expect(dom.sawText(loading)).toBe(false)
  })
})

describe('첫 장을 불러오지 못하면', () => {
  const failure = () => screen.findByRole('heading', { level: 2, name: loadFailed })

  it.each([
    ['서버 오류', () => problem(500, 'INTERNAL_ERROR')],
    ['연결 오류', () => HttpResponse.error()],
    ['모양이 다른 응답', () => HttpResponse.json([categoryOf('EXPENSE', '식비')])],
  ])('%s: 칩 자리에 오류와 "다시 시도"를 h2로 보이고 "다음"은 그대로다', async (_, respond) => {
    categories.response = respond
    const opened = await openApp('/welcome')
    await failure()
    expect(screen.queryByRole('list')).toBeNull()
    expect(screen.queryByRole('heading', { level: 2, name: '지출' })).toBeNull()
    expect(screen.getByText('잠시 후 다시 시도해 주세요.')).toBeTruthy()
    expect(screen.getByText(note)).toBeTruthy()
    await opened.user.click(nextButton())
    expect(await secondHeading()).toBeTruthy()
  })

  it('"다시 시도"를 누르면 그 버튼만 처리 중이고, 받으면 칩을 보인다', async () => {
    categories.response = () => problem(500, 'INTERNAL_ERROR')
    const { user } = await openApp('/welcome')
    await failure()
    const answer = delayed()
    categories.response = answer.respond
    await user.click(retryButton())
    await answer.arrived
    await waitFor(() => expect(retryButton().getAttribute('aria-busy')).toBe('true'))
    answer.answer(HttpResponse.json({ items: [categoryOf('EXPENSE', '식비')] }))
    expect(await screen.findByText('식비')).toBeTruthy()
    expect(screen.queryByText(loadFailed)).toBeNull()
  })
})

describe('장 사이의 이동', () => {
  it('둘째 장에서 뒤로 가면 첫 장이다. 쓴 값이 있어도 묻지 않는다', async () => {
    const opened = await openSecond()
    await fill(opened.user)
    await act(() => opened.router.navigate(-1))
    expect(await firstHeading()).toBeTruthy()
    expect(path(opened)).toBe('/welcome')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(created()).toEqual([])
  })

  it('앞으로 다시 가면 쓰던 값이 남아 있다', async () => {
    const opened = await openSecond()
    await fill(opened.user)
    await act(() => opened.router.navigate(-1))
    await firstHeading()
    await act(() => opened.router.navigate(1))
    await secondHeading()
    expect(name().value).toBe('국민은행 통장')
    expect(balance().value).toBe('350,000')
  })

  it('둘째 장의 주소로 새로 열어도 둘째 장이다', async () => {
    await openApp('/welcome?step=2')
    expect(await secondHeading()).toBeTruthy()
    expect(name().value).toBe('')
  })

  it.each(['/welcome?step=3', '/welcome?step=abc', '/welcome?step='])('모르는 장 %s는 첫 장이다', async (address) => {
    await openFirst(address)
    expect(screen.getByRole('heading', { level: 1, name: firstTitle })).toBeTruthy()
  })

  it('장을 옮기면 새 장의 제목에 초점이 가고, 처음 열 때는 초점을 두지 않는다', async () => {
    const opened = await openFirst()
    expect(document.activeElement).toBe(document.body)
    await opened.user.click(nextButton())
    const second = await secondHeading()
    await waitFor(() => expect(document.activeElement).toBe(second))
    await act(() => opened.router.navigate(-1))
    const first = await firstHeading()
    await waitFor(() => expect(document.activeElement).toBe(first))
  })
})

describe('둘째 장(2/2)의 요소와 처음 값', () => {
  it('진행 표시 "2/2"("2장 중 2장"), 제목, 설명, 칸 넷, 계좌 만들기, 건너뛰기와 그 설명이 위에서부터 놓인다', async () => {
    await openSecond()
    expect(screen.getByText('2/2').getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByText('2장 중 2장')).toBeTruthy()
    const all = [...document.querySelectorAll('*')]
    const parts = [
      screen.getByText('2/2'),
      screen.getByRole('heading', { level: 1 }),
      screen.getByText(description),
      name(),
      typeGroup(),
      sign(),
      balance(),
      date(),
      createButton(),
      skipButton(),
      screen.getByText(skipNote),
    ]
    const positions = parts.map((part) => all.indexOf(part))
    expect(positions).toEqual(positions.toSorted((a, b) => a - b))
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it('설명은 보조 글자색의 본문이다', async () => {
    await openSecond()
    const style = getComputedStyle(screen.getByText(description))
    expect(style.font).toBe('var(--text-body)')
    expect(style.color).toBe('var(--color-text-secondary)')
  })

  it('계좌 이름은 비어 있고 흐린 예시가 있으며 도움말이 없다', async () => {
    await openSecond()
    expect(name().value).toBe('')
    expect(name().placeholder).toBe('예: 국민은행 통장')
    expect(name().getAttribute('aria-describedby')).toBeNull()
    expect(screen.queryByText('1~50자')).toBeNull()
    expect(name().autocomplete).toBe('off')
  })

  it('종류는 은행, 카드, 현금이고 처음에는 은행이다', async () => {
    await openSecond()
    expect(within(typeGroup()).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['은행', '카드', '현금'])
    expect(type('은행').getAttribute('aria-checked')).toBe('true')
  })

  it('시작 잔액은 계좌 추가와 같은 금액 칸과 +/- 버튼이고 0, +다', async () => {
    await openSecond()
    expect(balance().value).toBe('0')
    expect(sign().getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText('마이너스 통장이면 -로 바꿔 적어요.')).toBeTruthy()
  })

  it('카드를 고르면 갚을 금액을 묻고 부호 버튼이 없으며, 금액의 뜻이 바뀌었다고 알린다', async () => {
    const { user } = await openSecond()
    await user.click(balance())
    await user.keyboard('350000')
    await user.click(type('카드'))
    expect(owed().value).toBe('350,000')
    expect(screen.getByText('카드는 지금 갚을 금액을 적어요.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '마이너스' })).toBeNull()
    expect(screen.getByText(typeNotice)).toBeTruthy()
  })

  it('은행과 현금 사이에서는 금액의 뜻이 그대로라 알리지 않는다', async () => {
    const { user } = await openSecond()
    await user.click(type('현금'))
    expect(screen.queryByText(typeNotice)).toBeNull()
  })

  it('기준일은 기기의 오늘이고 도움말은 C-02의 문구다', async () => {
    const { user } = await openSecond()
    expect(date().textContent).toBe('11월 26일 (목)')
    expect(screen.getByText('이날부터의 거래가 잔액에 반영돼요.')).toBeTruthy()
    await user.click(date())
    await untilOpened()
    await user.click(screen.getByRole('gridcell', { name: '2026년 11월 3일 화요일' }))
    expect(date().textContent).toBe('11월 3일 (화)')
  })

  it('"건너뛰기"는 글자 버튼이고 바로 아래 설명이 그 버튼의 설명으로 읽힌다', async () => {
    await openSecond()
    const described = skipButton().getAttribute('aria-describedby')!
    expect(document.getElementById(described)!.textContent).toBe(skipNote)
    const style = getComputedStyle(screen.getByText(skipNote))
    expect(style.font).toBe('var(--text-caption)')
    expect(style.color).toBe('var(--color-text-secondary)')
    expect(style.textAlign).toBe('center')
    expect(skipButton().nextElementSibling).toBe(screen.getByText(skipNote))
  })

  it('여는 때 오류와 알림이 없다', async () => {
    await openSecond()
    expect(errors()).toEqual([undefined, undefined, undefined, undefined])
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(typeNotice)).toBeNull()
  })
})

describe('계좌 만들기', () => {
  it('입력하고 누르면 계좌를 만들고 /home으로 replace하며 토스트 "계좌를 만들었어요"를 보인다', async () => {
    const opened = await openSecond()
    await fill(opened.user)
    await opened.user.click(date())
    await untilOpened()
    await opened.user.click(screen.getByRole('gridcell', { name: '2026년 11월 3일 화요일' }))
    await opened.user.click(createButton())
    await home()
    expect(path(opened)).toBe('/home')
    expect(opened.router.state.historyAction).toBe('REPLACE')
    expect(toast()).toBe('계좌를 만들었어요')
    expect(accounts.added).toEqual([
      {
        ledgerId: 'user-1-ledger',
        body: { name: '국민은행 통장', type: 'BANK', openingBalance: 350000, openingDate: '2026-11-03' },
      },
    ])
  })

  it.each([
    ['카드의 갚을 금액은 음수로', '카드', false, { type: 'CARD', openingBalance: -350000 }],
    ['마이너스 통장은 음수로', '은행', true, { type: 'BANK', openingBalance: -350000 }],
    ['현금', '현금', false, { type: 'CASH', openingBalance: 350000 }],
  ] as const)('%s 보낸다', async (_, label, negative, expected) => {
    const { user } = await openSecond()
    await fill(user)
    await user.click(type(label))
    if (negative) await user.click(sign())
    await user.click(createButton())
    await home()
    expect(created()[0]).toMatchObject(expected)
  })

  it('이름은 앞뒤 공백을 지우고 조합형으로 맞춰 보낸다', async () => {
    const { user } = await openSecond()
    await fill(user, { name: `  ${'통장'.normalize('NFD')}\u{A0}` })
    await user.click(createButton())
    await home()
    expect(created()[0].name).toBe('통장')
  })

  it('칸에서 엔터를 쳐도 만든다', async () => {
    const { user } = await openSecond()
    await fill(user)
    await user.type(name(), '{Enter}')
    await home()
    expect(created()).toHaveLength(1)
  })

  it('두 번 누르거나 엔터를 눌러도 한 번만 보낸다', async () => {
    accounts.addResponse = delayed().respond
    const { user } = await openSecond()
    await fill(user)
    await user.dblClick(createButton())
    await user.type(name(), '{Enter}')
    await user.click(skipButton())
    await settle()
    expect(accounts.added).toHaveLength(1)
  })

  it('만든 뒤 뒤로 가서 /welcome이 열려도 안내가 다시 나오지 않고 /home으로 replace한다', async () => {
    const opened = await openSecond()
    await fill(opened.user)
    await opened.user.click(createButton())
    await home()
    await act(() => opened.router.navigate(-1))
    await waitFor(() => expect(path(opened)).toBe('/home'))
    expect(opened.router.state.historyAction).toBe('REPLACE')
    expect(screen.queryByRole('heading', { level: 1, name: firstTitle })).toBeNull()
  })

  it('입력값을 주소에 싣지 않는다', async () => {
    const opened = await openSecond()
    await fill(opened.user)
    await opened.user.click(createButton())
    await home()
    expect(opened.router.state.location.search).toBe('')
    expect(opened.router.state.location.state).toBeNull()
  })
})

describe('계좌 만들기 전의 검사', () => {
  it('모든 칸을 검사하고 위에서부터 첫 오류 칸으로 초점이 가며 보내지 않는다', async () => {
    const { user } = await openSecond()
    await user.click(balance())
    await user.keyboard('{Backspace}')
    await user.click(createButton())
    expect(errors()).toEqual([nameRequired, undefined, amountRequired, undefined])
    expect(document.activeElement).toBe(name())
    await user.type(name(), '통장')
    await user.click(createButton())
    expect(errors()).toEqual([undefined, undefined, amountRequired, undefined])
    expect(document.activeElement).toBe(balance())
    expect(created()).toEqual([])
  })

  it.each([
    ['공백류뿐', ' \u{A0}\u{3000}', nameRequired],
    ['51자', '가'.repeat(51), nameTooLong],
    ['보이지 않는 글자', '통장\u{200B}', nameUnusable],
  ])('이름이 %s이면 칸을 벗어날 때 알린다', async (_, value, message) => {
    const { user } = await openSecond()
    await user.click(name())
    await user.paste(value)
    await user.tab()
    expect(errorOf(name())).toBe(message)
  })

  it('41자부터 글자 수가 보인다', async () => {
    const { user } = await openSecond()
    await user.click(name())
    await user.paste('가'.repeat(41))
    expect(screen.getByText('41/50')).toBeTruthy()
  })

  it('금액의 11번째 숫자는 들어가지 않고 알린다', async () => {
    const { user } = await openSecond()
    await user.click(balance())
    await user.keyboard('99999999999')
    expect(balance().value).toBe('9,999,999,999')
    expect(errorOf(balance())).toBe(amountTooLarge)
  })

  it('버튼은 오류가 있어도 누를 수 있다', async () => {
    const { user } = await openSecond()
    await user.click(createButton())
    expect(createButton().hasAttribute('aria-disabled')).toBe(false)
    expect(skipButton().hasAttribute('aria-disabled')).toBe(false)
  })

  it.each([
    ['계좌 만들기', createButton],
    ['건너뛰기', skipButton],
  ])('"%s"를 누르는 사이에 오류 문구가 나와 밀리지 않는다', async (_, target) => {
    const { user } = await openSecond()
    await user.click(name())
    await user.pointer({ keys: '[MouseLeft>]', target: target() })
    expect(errors()).toEqual([undefined, undefined, undefined, undefined])
  })
})

describe('서버가 거부함', () => {
  it.each([
    ['name', 'REQUIRED', 0, nameRequired],
    ['name', 'TOO_LONG', 0, nameTooLong],
    ['name', 'INVALID_FORMAT', 0, nameUnusable],
    ['name', 'DUPLICATE', 0, nameDuplicate],
    ['type', 'REQUIRED', 1, typeRequired],
    ['type', 'INVALID_FORMAT', 1, typeRequired],
    ['openingBalance', 'REQUIRED', 2, amountRequired],
    ['openingBalance', 'OUT_OF_RANGE', 2, amountTooLarge],
    ['openingDate', 'REQUIRED', 3, dateRequired],
    ['openingDate', 'INVALID_FORMAT', 3, dateRequired],
    ['openingDate', 'OUT_OF_RANGE', 3, dateOutOfRange],
  ] as const)('%s %s는 그 칸 아래에 보이고 초점이 그 칸으로 간다', async (field, code, index, message) => {
    accounts.addResponse = refuse([field, code])
    const opened = await openSecond()
    await fill(opened.user)
    await opened.user.click(createButton())
    await waitFor(() => expect(errors()[index]).toBe(message))
    expect(errors().filter(Boolean)).toEqual([message])
    expect(document.activeElement).toBe(index === 1 ? type('은행') : controls()[index])
    expect(screen.queryByRole('alert')).toBeNull()
    expect(path(opened)).toBe('/welcome?step=2')
    expect(document.body.textContent).not.toContain('개발자가 읽는')
  })
})

describe('건너뛰기', () => {
  it('확인 없이 "현금" 계좌(현금, 0원, 오늘)를 만들고 /home으로 replace하며 토스트 "현금 계좌를 만들었어요"를 보인다', async () => {
    const opened = await openSecond()
    await opened.user.click(skipButton())
    await home()
    expect(created()).toEqual([{ name: '현금', type: 'CASH', openingBalance: 0, openingDate: '2026-11-26' }])
    expect(path(opened)).toBe('/home')
    expect(opened.router.state.historyAction).toBe('REPLACE')
    expect(toast()).toBe('현금 계좌를 만들었어요')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('이 장에 쓰던 값은 쓰지 않고, 틀린 칸이 있어도 검사하지 않는다', async () => {
    const { user } = await openSecond()
    await fill(user, { name: '가'.repeat(60), amount: '123' })
    await user.click(type('카드'))
    await user.click(date())
    await untilOpened()
    await user.click(screen.getByRole('gridcell', { name: '2026년 11월 3일 화요일' }))
    await user.click(skipButton())
    await home()
    expect(created()).toEqual([{ name: '현금', type: 'CASH', openingBalance: 0, openingDate: '2026-11-26' }])
  })

  it('같은 이름 "현금"이 이미 있다고 거부되면(다른 구성원이 먼저 만듦) 계좌가 생긴 것으로 보고 토스트 없이 /home으로 가며 목록을 다시 받는다', async () => {
    accounts.addResponse = refuse(['name', 'DUPLICATE'])
    const opened = await openSecond()
    const before = accounts.requests.length
    accounts.items = [accountOf('현금', 'CASH', 0)]
    await opened.user.click(skipButton())
    await home()
    expect(path(opened)).toBe('/home')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(toast()).toBeUndefined()
    await waitFor(() => expect(accounts.requests.length).toBe(before + 1))
    await act(() => opened.router.navigate(-1))
    await waitFor(() => expect(path(opened)).toBe('/home'))
  })

  it.each([
    ['이름의 다른 거부', refuse(['name', 'INVALID_FORMAT'])],
    ['다른 칸의 거부', refuse(['openingDate', 'OUT_OF_RANGE'])],
  ])('%s는 칸에 보이지 않고 실패 문구다', async (_, respond) => {
    accounts.addResponse = respond
    const { user } = await openSecond()
    await user.click(skipButton())
    expect((await screen.findByRole('alert')).textContent).toBe(failed)
    expect(errors()).toEqual([undefined, undefined, undefined, undefined])
  })

  describe.each([
    // 같은 순간도 기기의 시간대에 따라 오늘이 다르다. 서울 자정의 앞뒤
    ['Asia/Seoul', '2026-11-25T14:59:59.999Z', '2026-11-25', '11월 25일 (수)'],
    ['Asia/Seoul', '2026-11-25T15:00:00.000Z', '2026-11-26', '11월 26일 (목)'],
    ['UTC', '2026-11-25T23:59:59.999Z', '2026-11-25', '11월 25일 (수)'],
    ['UTC', '2026-11-26T00:00:00.000Z', '2026-11-26', '11월 26일 (목)'],
    ['America/Los_Angeles', '2026-11-26T07:59:59.999Z', '2026-11-25', '11월 25일 (수)'],
    ['America/Los_Angeles', '2026-11-26T08:00:00.000Z', '2026-11-26', '11월 26일 (목)'],
    ['Asia/Seoul', '2026-12-31T15:00:00.000Z', '2027-01-01', '1월 1일 (금)'],
  ])('기기의 시간대가 %s이고 지금이 %s이면', (timeZone, instant, today, shown) => {
    beforeEach(() => {
      vi.stubEnv('TZ', timeZone)
      vi.setSystemTime(new Date(instant))
    })

    it(`기준일의 처음 값과 건너뛰기의 기준일은 기기의 오늘 ${today}이다`, async () => {
      const { user } = await openSecond()
      expect(date().textContent).toBe(shown)
      await user.click(skipButton())
      await home()
      expect(created()[0].openingDate).toBe(today)
    })
  })
})

describe('처리 중', () => {
  const both = () => [createButton(), skipButton()]

  async function start(press: () => HTMLElement) {
    const answer = delayed()
    accounts.addResponse = answer.respond
    const opened = await openSecond()
    await fill(opened.user)
    await opened.user.click(press())
    await answer.arrived
    return { ...opened, answer }
  }

  it.each([
    ['계좌 만들기', createButton, skipButton],
    ['건너뛰기', skipButton, createButton],
  ])('"%s"를 누르면 그 버튼만 돌아가는 원이고 두 버튼 모두 비활성, 칸은 읽기 전용이다', async (_, pressed, other) => {
    const { user, answer } = await start(pressed)
    await waitFor(() => expect(pressed().getAttribute('aria-busy')).toBe('true'))
    expect(pressed().querySelector('.status-motion')).toBeTruthy()
    expect(other().hasAttribute('aria-busy')).toBe(false)
    expect(other().querySelector('.status-motion')).toBeNull()
    expect(both().map((button) => button.getAttribute('aria-disabled'))).toEqual(['true', 'true'])
    expect([name().readOnly, balance().readOnly]).toEqual([true, true])
    expect(typeGroup().getAttribute('aria-readonly')).toBe('true')

    await user.click(createButton())
    await user.click(skipButton())
    await user.click(type('카드'))
    expect(type('은행').getAttribute('aria-checked')).toBe('true')
    await settle()
    expect(accounts.added).toHaveLength(1)

    answer.answer(problem(500, 'INTERNAL_ERROR'))
    await screen.findByRole('alert')
    expect(both().map((button) => button.hasAttribute('aria-disabled'))).toEqual([false, false])
    expect([name().readOnly, balance().readOnly]).toEqual([false, false])
  })

  it('성공해 /home으로 갈 때까지 버튼이 풀리지 않는다', async () => {
    const { answer } = await start(createButton)
    const changes: MutationRecord[] = []
    const observer = new MutationObserver((records) => void changes.push(...records))
    observer.observe(createButton(), { attributeFilter: ['aria-busy', 'aria-disabled'] })
    answer.answer(HttpResponse.json(accountOf('국민은행 통장', 'BANK', 350000), { status: 201 }))
    await home()
    expect([...changes, ...observer.takeRecords()].filter(({ target }) => target.isConnected)).toEqual([])
    observer.disconnect()
  })
})

describe('서버 오류와 지연', () => {
  it.each([
    ['500', () => problem(500, 'INTERNAL_ERROR')],
    ['읽을 수 없는 502', () => new HttpResponse('<html>', { status: 502 })],
    ['연결 오류', () => HttpResponse.error()],
    ['모르는 칸만 온 400', refuse(['memo', 'TOO_LONG'])],
    ['약속과 다른 201', () => HttpResponse.json({}, { status: 201 })],
  ])('%s이면 "계좌 만들기" 바로 위에 문구와 "다시 시도"를 보이고 입력값이 남는다', async (_, respond) => {
    accounts.addResponse = respond
    const opened = await openSecond()
    await fill(opened.user)
    await opened.user.click(createButton())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(failed)
    const notice = createButton().previousElementSibling as HTMLElement
    expect(notice.contains(alert)).toBe(true)
    expect(notice.contains(retryButton())).toBe(true)
    expect([name().value, balance().value]).toEqual(['국민은행 통장', '350,000'])
    expect(path(opened)).toBe('/welcome?step=2')
  })

  it.each([
    ['계좌 만들기', createButton],
    ['건너뛰기', skipButton],
  ])('"%s"가 실패해도 초점을 옮기지 않는다', async (_, press) => {
    accounts.addResponse = () => problem(500, 'INTERNAL_ERROR')
    const { user } = await openSecond()
    await fill(user)
    press().focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('alert')
    await settle()
    expect(document.activeElement).toBe(press())
  })

  it('"계좌 만들기"의 "다시 시도"는 지금 화면의 값으로 다시 만들고 초점을 잃지 않는다', async () => {
    const answers = [() => problem(500, 'INTERNAL_ERROR'), delayed().respond]
    accounts.addResponse = () => answers.shift()!()
    const { user } = await openSecond()
    await fill(user)
    await user.click(createButton())
    await screen.findByRole('alert')
    await user.type(name(), '2')
    await user.click(retryButton())
    await waitFor(() => expect(accounts.added).toHaveLength(2))
    expect(created()[1].name).toBe('국민은행 통장2')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.activeElement).toBe(createButton())
  })

  it('"건너뛰기"의 "다시 시도"는 다시 건너뛰고 초점을 잃지 않는다', async () => {
    const answers = [() => problem(500, 'INTERNAL_ERROR'), delayed().respond]
    accounts.addResponse = () => answers.shift()!()
    const { user } = await openSecond()
    await fill(user)
    await user.click(skipButton())
    await screen.findByRole('alert')
    await user.click(retryButton())
    await waitFor(() => expect(accounts.added).toHaveLength(2))
    expect(created()[1]).toEqual({ name: '현금', type: 'CASH', openingBalance: 0, openingDate: '2026-11-26' })
    expect(document.activeElement).toBe(skipButton())
    expect(skipButton().getAttribute('aria-busy')).toBe('true')
  })

  it('다시 시도할 때 칸이 틀렸으면 보내지 않고 문구를 지운 뒤 칸의 오류를 보인다', async () => {
    accounts.addResponse = () => problem(500, 'INTERNAL_ERROR')
    const { user } = await openSecond()
    await fill(user)
    await user.click(createButton())
    await screen.findByRole('alert')
    await user.clear(name())
    await user.click(retryButton())
    expect(errorOf(name())).toBe(nameRequired)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(accounts.added).toHaveLength(1)
  })

  it('15초 동안 응답이 없으면 같은 문구를 보인다', async () => {
    accounts.addResponse = delayed().respond
    const { user } = await openSecond()
    await fill(user)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: new Date(2026, 10, 26, 12) })
    fireEvent.click(createButton())
    await act(() => vi.advanceTimersByTimeAsync(14_900))
    expect(screen.queryByRole('alert')).toBeNull()
    await act(() => vi.advanceTimersByTimeAsync(200))
    expect(screen.getByRole('alert').textContent).toBe(failed)
  })

  it('저절로 다시 보내지 않는다', async () => {
    accounts.addResponse = () => problem(500, 'INTERNAL_ERROR')
    const { user } = await openSecond()
    await user.click(skipButton())
    await screen.findByRole('alert')
    await settle()
    expect(accounts.added).toHaveLength(1)
  })
})

/** 넓은 화면(@media)의 규칙에서 선택자가 `selector`인 첫 규칙의 선언. jsdom이 계산하지 못하는 값을 읽는다. */
function wideRule(selector: string): string {
  const css = readWebFile(CSS)
  const wide = css.slice(css.indexOf('@media (width >= 1024px)'))
  const start = wide.indexOf(`${selector} {`)
  return wide.slice(start, wide.indexOf('}', start)).replace(/\s+/g, ' ')
}

describe('배치', () => {
  const bottomOf = (button: HTMLElement) => button.closest('[class*="bottom"]')!
  const scroller = (button: HTMLElement) => bottomOf(button).previousElementSibling!

  it.each([
    ['첫 장', openFirst, nextButton],
    ['둘째 장', openSecond, createButton],
  ])('%s: 휴대폰 배치는 내용만 스크롤하고 버튼을 화면 맨 아래 면과 선이 있는 영역에 고정한다', async (_, open, button) => {
    await open()
    setViewportWidth(390)
    const bottom = getComputedStyle(bottomOf(button()))
    expect(bottom.backgroundColor).toBe('var(--color-surface)')
    expect(readCssRule(CSS, '.bottom')).toContain('border-top: 1px solid var(--color-border);')
    expect(readCssRule(CSS, '.bottom')).toContain(
      'padding-block: var(--space-12) calc(var(--space-12) + env(safe-area-inset-bottom));',
    )
    expect(getComputedStyle(scroller(button())).overflowY).toBe('auto')
    expect(getComputedStyle(bottomOf(button()).parentElement!).height).toBe('100dvh')
  })

  it('위 여백은 24px에 위 안전 영역을 더하고, 진행 표시와 제목 사이는 8px, 제목과 첫 소제목 사이는 24px이다', async () => {
    await openFirst()
    setViewportWidth(390)
    expect(readCssRule(CSS, '.content')).toContain(
      'padding-block: calc(var(--space-24) + env(safe-area-inset-top)) var(--space-24);',
    )
    expect(getComputedStyle(screen.getByRole('heading', { level: 1 })).marginTop).toBe('var(--space-8)')
    const group = screen.getByRole('heading', { level: 2, name: '지출' }).parentElement!
    expect(getComputedStyle(group).marginTop).toBe('var(--space-24)')
    expect(getComputedStyle(screen.getByRole('heading', { level: 2, name: '지출' })).font).toBe('var(--text-label)')
    expect(getComputedStyle(screen.getByRole('heading', { level: 2, name: '지출' })).marginBottom).toBe('var(--space-8)')
    const chips = getComputedStyle(screen.getByRole('list', { name: '지출' }))
    expect(chips.display).toBe('flex')
    expect(chips.flexWrap).toBe('wrap')
    expect(chips.gap).toBe('var(--space-8)')
    const noteStyle = getComputedStyle(screen.getByText(note))
    expect(noteStyle.marginTop).toBe('var(--space-24)')
    expect(noteStyle.font).toBe('var(--text-body)')
    expect(noteStyle.color).toBe('var(--color-text-secondary)')
  })

  it('둘째 장의 설명은 제목 아래 8px, 첫 칸은 설명 아래 24px이고 칸 사이는 16px이다', async () => {
    await openSecond()
    setViewportWidth(390)
    expect(getComputedStyle(screen.getByText(description)).marginTop).toBe('var(--space-8)')
    const fields = getComputedStyle(name().closest('[class*="fields"]')!)
    expect(fields.marginTop).toBe('var(--space-24)')
    expect(fields.gap).toBe('var(--space-16)')
  })

  it('"계좌 만들기"와 "건너뛰기" 사이는 8px이고 "건너뛰기"와 설명은 가운데에 붙어 있다', async () => {
    await openSecond()
    setViewportWidth(390)
    expect(getComputedStyle(bottomOf(createButton())).gap).toBe('var(--space-8)')
    const skip = getComputedStyle(skipButton().parentElement!)
    expect(skip.flexDirection).toBe('column')
    expect(skip.alignItems).toBe('center')
    expect(getComputedStyle(screen.getByText(skipNote)).marginTop).toBe('0px')
  })

  it('서버 오류 문구와 "다시 시도"는 고정한 영역 안에 있다', async () => {
    accounts.addResponse = () => problem(500, 'INTERNAL_ERROR')
    const { user } = await openSecond()
    await user.click(skipButton())
    expect(bottomOf(createButton()).contains(await screen.findByRole('alert'))).toBe(true)
  })

  it.each([
    ['첫 장', openFirst, nextButton],
    ['둘째 장', openSecond, createButton],
  ])('%s: 넓은 화면은 폭 480px로 가운데에 두고 위 40px, 버튼은 내용 아래 24px에 면과 선 없이 둔다', async (_, open, button) => {
    await open()
    setViewportWidth(1280)
    const bottom = getComputedStyle(bottomOf(button()))
    expect(bottom.backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(bottom.borderTopWidth).toBe('0px')
    expect(wideRule('.bottom')).toContain('padding-top: var(--space-24);')
    expect(getComputedStyle(scroller(button())).overflowY).toBe('visible')
    expect(getComputedStyle(bottomOf(button()).parentElement!).height).toBe('auto')
    const page = getComputedStyle(screen.getByRole('main'))
    expect(page.maxWidth).toContain('var(--width-dialog)')
    expect(page.getPropertyValue('margin-inline')).toBe('auto')
    expect(wideRule('.page')).toContain('calc(var(--space-40) + env(safe-area-inset-top))')
  })

  it('휴대폰 배치는 폭을 줄이지 않는다', async () => {
    await openFirst()
    setViewportWidth(390)
    expect(getComputedStyle(screen.getByRole('main')).maxWidth).not.toContain('var(--width-dialog)')
  })
})
