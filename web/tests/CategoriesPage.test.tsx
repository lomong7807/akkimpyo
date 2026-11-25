import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { delayed, startBackend, type Backend } from './support/backend'
import { readCssRule } from './support/cssRule'
import { startMockServer } from './support/mockServer'
import { addScreens, openApp } from './support/openApp'
import { problem } from './support/problem'
import { recordDom } from './support/recordDom'
import { installMatchMedia, resetViewport, setViewportWidth } from './support/viewport'
import { readWebFile } from './support/webFile'

const CSS = 'src/features/categories/Categories.module.css'
const empty = '아직 만든 카테고리가 없어요.'
const loading = '불러오고 있어요.'
const failed = '불러오지 못했어요.'

const server = startMockServer()
let backend: Backend

type Kind = 'EXPENSE' | 'INCOME'

const category = (kind: Kind, name: string, children: string[] = [], system = false) => ({
  id: `${kind}-${name}`,
  kind,
  name,
  system,
  children: children.map((child) => ({ id: `${kind}-${name}-${child}`, name: child })),
})
const uncategorized = (kind: Kind, name = '미분류') => category(kind, name, [], true)

const items = [
  category('EXPENSE', '식비', ['외식', '장보기']),
  category('EXPENSE', '카페·간식'),
  category('EXPENSE', '교통', ['택시']),
  category('EXPENSE', '기타'),
  uncategorized('EXPENSE'),
  category('INCOME', '급여'),
  category('INCOME', '부수입', ['중고 판매']),
  uncategorized('INCOME'),
]

/** 카테고리 API. 다음 응답을 정하고 받은 요청을 모은다. */
const api = {
  response: (): Response | Promise<Response> => HttpResponse.json({ items }),
  /** 요청을 보낸 사용자와 장부 id */
  requests: [] as string[],
}
const respondWith = (changed: unknown[]) => {
  api.response = () => HttpResponse.json({ items: changed })
}

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn())
  backend = startBackend(server)
  backend.cookieUser = 'user-1'
  respondWith(items)
  api.requests = []
  server.use(
    http.get('/api/v1/ledgers/:ledgerId/categories', ({ request, params }) => {
      api.requests.push(`${backend.userOf(request)} ${String(params.ledgerId)}`)
      return api.response()
    }),
  )
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  resetViewport()
  vi.unstubAllGlobals()
})

async function open(path = '/categories', width = 390) {
  installMatchMedia(width)
  const opened = await openApp(path)
  await screen.findByRole('main')
  await menu()
  setViewportWidth(width)
  return opened
}

/** 목록까지 받은 화면 */
async function openList(width = 390) {
  const opened = await open('/categories', width)
  await list()
  return opened
}

const menu = () => screen.findByRole('navigation', { name: '주 메뉴' })
const title = () => screen.findByRole('heading', { level: 1, name: '카테고리' })
const content = () => within(screen.getByRole('main'))
const option = (name: string) => screen.getByRole('radio', { name })
const chosen = () => screen.getAllByRole('radio', { checked: true }).map((radio) => radio.textContent)
const failure = () => screen.findByRole('heading', { level: 2, name: failed })
const retry = () => screen.getByRole('button', { name: '다시 시도' })
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 30)))

/** 최상위 목록 */
const list = () => content().findAllByRole('list').then(([first]) => first)
const itemsIn = (element: Element) => [...element.children] as HTMLElement[]
/** 최상위 줄과 그 하위의 이름. 미분류 줄은 글자를 모두 잇는다. */
const tree = async () =>
  itemsIn(await list()).map((item) => {
    const nested = within(item).queryByRole('list')
    const own = nested ? item.textContent!.slice(0, -nested.textContent!.length) : item.textContent
    return nested ? [own, itemsIn(nested).map((child) => child.textContent)] : own
  })
/** 이름이 든 줄(높이와 여백을 가진 요소) */
const rowOf = (name: string) => content().getByText(name).parentElement!
const styleOf = (element: Element) => getComputedStyle(element)

const uncategorizedRow = '미분류이름을 바꾸거나 지울 수 없어요기본'

describe('카테고리(H-01)에 들어가는 길', () => {
  it('더보기의 "카테고리" 줄을 누르면 들어간다', async () => {
    const { router, user } = await open('/more')
    await user.click(content().getByRole('link', { name: '카테고리' }))
    await title()
    expect(router.state.location.pathname).toBe('/categories')
  })

  it('하위 화면이다. 주소를 바로 열고 "뒤로"를 누르면 더보기로 간다', async () => {
    const { router, user } = await openList()
    const bar = within(screen.getByRole('banner'))
    expect(bar.getByRole('heading', { level: 1, name: '카테고리' })).toBeTruthy()
    await user.click(bar.getByRole('button', { name: '뒤로' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/more'))
  })

  it('하단 탭에서는 더보기가 강조된다', async () => {
    await openList()
    const current = within(await menu()).getAllByRole('link', { current: 'page' })
    expect(current.map((link) => link.textContent)).toEqual(['더보기'])
  })

  it('넓은 화면에서는 사이드바의 "카테고리"로 들어가고 그 항목이 강조된다. 항목에는 아이콘이 없다', async () => {
    const { router, user } = await open('/home', 1280)
    const item = within(await menu()).getByRole('link', { name: '카테고리' })
    expect(item.querySelector('svg')).toBeNull()
    await user.click(item)
    await title()
    expect(router.state.location.pathname).toBe('/categories')
    const current = within(await menu()).getAllByRole('link', { current: 'page' })
    expect(current.map((link) => link.textContent)).toEqual(['카테고리'])
  })

  it('로그인하지 않았으면 로그인 화면으로 보내고 로그인하면 돌아온다', async () => {
    backend.cookieUser = undefined
    installMatchMedia(390)
    const { router, user } = await openApp('/categories')
    await screen.findByRole('heading', { level: 1, name: '로그인' })
    expect(api.requests).toEqual([])
    await user.type(screen.getByLabelText('이메일'), 'name@example.com')
    await user.type(screen.getByLabelText('비밀번호'), 'pass1234')
    await user.click(screen.getByRole('button', { name: '로그인' }))
    await title()
    expect(router.state.location.pathname).toBe('/categories')
  })
})

describe('카테고리 목록', () => {
  it('로그인한 사용자의 현재 장부 것을 한 번 받는다', async () => {
    await openList()
    expect(api.requests).toEqual(['user-1 user-1-ledger'])
  })

  it('최상위 줄 아래에 하위를 겹친 목록으로 두고, 순서는 받은 그대로다', async () => {
    await openList()
    expect(await tree()).toEqual([['식비', ['외식', '장보기']], '카페·간식', ['교통', ['택시']], '기타', uncategorizedRow])
  })

  it('고른 구분의 것만 보이고 이름이나 만든 순으로 다시 늘어놓지 않는다', async () => {
    respondWith([
      category('EXPENSE', '나'),
      category('INCOME', '하'),
      category('EXPENSE', '가', ['2', '1']),
      category('INCOME', '다'),
    ])
    const { user } = await openList()
    expect(await tree()).toEqual(['나', ['가', ['2', '1']]])
    await user.click(option('수입'))
    expect(await tree()).toEqual(['하', '다'])
  })

  it('줄은 링크나 버튼이 아니고 초점을 받지 않는다. "추가"도 없다', async () => {
    const { user } = await openList()
    const listed = within(await list())
    expect(listed.queryAllByRole('link')).toEqual([])
    expect(listed.queryAllByRole('button')).toEqual([])
    expect(screen.queryByText('추가')).toBeNull()
    option('지출').focus()
    await user.tab()
    expect(screen.getByRole('main').contains(document.activeElement)).toBe(false)
  })

  it('줄은 높이 56px 이상의 본문 글자이고 아이콘, 화살표, 줄 사이 선, 누름 바탕이 없다', async () => {
    await openList()
    for (const name of ['식비', '외식', '카페·간식']) {
      const row = styleOf(rowOf(name))
      expect(row.minHeight).toBe('var(--size-row)')
      expect(row.getPropertyValue('padding-block')).toBe('var(--space-8)')
    }
    expect((await list()).querySelector('svg')).toBeNull()
    expect(readCssRule(CSS, '.row')).not.toMatch(/border|background|cursor|font/)
    expect(readCssRule(CSS, '.name')).not.toContain('font')
    expect(readWebFile(CSS)).not.toMatch(/:(hover|active)/)
  })

  it('하위 줄은 16px 들여 쓰고 나머지 모양은 최상위 줄과 같다', async () => {
    await openList()
    const [nested] = within(await list()).getAllByRole('list')
    expect(styleOf(nested).paddingInlineStart || styleOf(nested).getPropertyValue('padding-inline-start')).toBe(
      'var(--space-16)',
    )
    expect(rowOf('외식').className).toBe(rowOf('식비').className)
  })

  it('긴 이름은 줄임표로 자르지 않고 낱말 중간에서라도 줄을 바꿔 다 보인다. 줄은 커진다', async () => {
    const long = '가나다라마바사아자차카타파하거너더러머버'
    const longChild = `${long.slice(1)}서`
    respondWith([category('EXPENSE', long, [longChild]), uncategorized('EXPENSE')])
    await openList()
    for (const name of [long, longChild]) {
      const style = styleOf(content().getByText(name))
      expect(style.overflowWrap).toBe('anywhere')
      expect(style.whiteSpace).not.toBe('nowrap')
      expect(style.textOverflow).not.toBe('ellipsis')
      expect(styleOf(rowOf(name)).getPropertyValue('padding-block')).toBe('var(--space-8)')
      expect(styleOf(rowOf(name)).height).not.toBe('var(--size-row)')
    }
  })
})

describe('미분류', () => {
  it('이름이 아니라 system으로 판단한다', async () => {
    respondWith([
      category('EXPENSE', '식비', ['미분류']),
      uncategorized('EXPENSE', '나머지'),
      category('INCOME', '미분류'),
    ])
    const { user } = await openList()
    expect(await tree()).toEqual([['식비', ['미분류']], '나머지이름을 바꾸거나 지울 수 없어요기본'])
    await user.click(option('수입'))
    expect(await tree()).toEqual(['미분류'])
  })

  it('받은 자리와 상관없이 고른 구분의 맨 아래에 있다', async () => {
    respondWith([uncategorized('EXPENSE'), category('EXPENSE', '식비'), uncategorized('INCOME'), category('INCOME', '급여')])
    const { user } = await openList()
    expect(await tree()).toEqual(['식비', uncategorizedRow])
    await user.click(option('수입'))
    expect(await tree()).toEqual(['급여', uncategorizedRow])
  })

  it('위 목록과 1px 선과 위아래 24px로 나뉘고, 선은 휴대폰 배치에서 화면 끝까지 닿는다', async () => {
    await openList()
    const last = itemsIn(await list()).at(-1)!
    expect(styleOf(last).marginTop).toBe('var(--space-24)')
    expect(styleOf(last).paddingTop).toBe('var(--space-24)')
    expect(styleOf(last).getPropertyValue('margin-inline')).toBe('calc(-1 * var(--space-16))')
    expect(styleOf(last).getPropertyValue('padding-inline')).toBe('var(--space-16)')
    expect(readCssRule(CSS, '.fixed')).toContain('border-top: 1px solid var(--color-border)')
  })

  it.each([768, 1280])('폭 %dpx에서는 선이 내용 폭이다', async (width) => {
    await openList(width)
    const last = styleOf(itemsIn(await list()).at(-1)!)
    expect(last.getPropertyValue('margin-inline')).toMatch(/^0(px)?$/)
    expect(last.getPropertyValue('padding-inline')).toMatch(/^0(px)?$/)
  })

  it('높이 72px 이상이고 이름 아래에 보조 글자가 있다', async () => {
    await openList()
    const helper = content().getByText('이름을 바꾸거나 지울 수 없어요')
    expect(styleOf(helper).font).toBe('var(--text-secondary)')
    expect(styleOf(helper).color).toBe('var(--color-text-secondary)')
    expect(content().getByText('미분류').nextElementSibling).toBe(helper)
    expect(styleOf(content().getByText('기본').parentElement!).minHeight).toBe(
      'calc(var(--size-row) + var(--space-16))',
    )
  })

  it('"기본" 칩은 오른쪽 세로 가운데에 있고, 좁으면 글 아래로 내려간다', async () => {
    await openList()
    const chip = content().getByText('기본')
    const row = styleOf(chip.parentElement!)
    expect(row.display).toBe('flex')
    expect(row.alignItems).toBe('center')
    expect(row.flexWrap).toBe('wrap')
    const text = content().getByText('미분류').parentElement!
    expect(text.nextElementSibling).toBe(chip)
    expect(styleOf(text).flex).toBe('1 1 auto')
    expect(styleOf(chip).height).toBe('var(--size-chip)')
  })
})

describe('고른 구분에 미분류만 있으면', () => {
  const onlyUncategorized = [uncategorized('EXPENSE'), category('INCOME', '급여'), uncategorized('INCOME')]

  it('미분류 줄 위에 안내를 보이고 미분류 줄은 그대로다. 안내에 버튼이 없다', async () => {
    respondWith(onlyUncategorized)
    await openList()
    expect(await tree()).toEqual([uncategorizedRow])
    const order = content().getByText(empty).compareDocumentPosition(await list())
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(content().queryAllByRole('button')).toEqual([])
    expect(content().queryAllByRole('link')).toEqual([])
  })

  it('다른 구분을 고르면 안내가 사라지고, 돌아오면 다시 보인다', async () => {
    respondWith(onlyUncategorized)
    const { user } = await openList()
    await user.click(option('수입'))
    expect(content().queryByText(empty)).toBeNull()
    expect(await tree()).toEqual(['급여', uncategorizedRow])
    await user.click(option('지출'))
    expect(content().getByText(empty)).toBeTruthy()
  })

  it('안내는 고르기 상자에서 40px 아래에 있다(상자 아래 8px을 넣은 값). 아래는 24px과 선이다', async () => {
    respondWith(onlyUncategorized)
    await openList()
    const state = content().getByText(empty).parentElement!
    expect(styleOf(state).paddingTop).toBe('var(--space-40)')
    expect(styleOf(state.parentElement!).marginTop).toBe('calc(-1 * var(--space-8))')
    expect(styleOf(itemsIn(await list())[0]).marginTop).toBe('var(--space-24)')
    expect(styleOf(itemsIn(await list())[0]).paddingTop).toBe('var(--space-24)')
  })
})

it('만든 카테고리가 있는 구분에는 "아직 만든 카테고리가 없어요."가 없다', async () => {
  const { user } = await openList()
  expect(content().queryByText(empty)).toBeNull()
  await user.click(option('수입'))
  expect(content().queryByText(empty)).toBeNull()
})

describe('지출과 수입', () => {
  it('"구분"에 지출, 수입 두 칸이 있고 화면을 열면 지출이 골라져 있다', async () => {
    await openList()
    const group = screen.getByRole('radiogroup', { name: '구분' })
    expect(within(group).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['지출', '수입'])
    expect(chosen()).toEqual(['지출'])
  })

  it('수입을 고르면 목록만 바뀐다. 다시 요청하지 않고 주소와 저장소에 남기지 않는다', async () => {
    const { router, user } = await openList()
    const stored = () => JSON.stringify([{ ...localStorage }, { ...sessionStorage }])
    const before = { key: router.state.location.key, stored: stored() }
    await user.click(option('수입'))
    expect(chosen()).toEqual(['수입'])
    expect(await tree()).toEqual(['급여', ['부수입', ['중고 판매']], uncategorizedRow])
    await settle()
    expect(api.requests).toHaveLength(1)
    expect({ key: router.state.location.key, stored: stored() }).toEqual(before)
    expect(router.state.location.search).toBe('')
  })

  it('키보드로 고를 수 있다', async () => {
    const { user } = await openList()
    option('지출').focus()
    await user.keyboard('{ArrowRight}')
    expect(chosen()).toEqual(['수입'])
    expect((await tree())[0]).toBe('급여')
  })

  it('뒤로 갔다 다시 와도 지출이 골라져 있다', async () => {
    const { router, user } = await open('/more')
    await user.click(content().getByRole('link', { name: '카테고리' }))
    await list()
    await user.click(option('수입'))
    await act(() => router.navigate(-1))
    await screen.findByRole('link', { name: '카테고리' })
    await act(() => router.navigate(1))
    await list()
    expect(chosen()).toEqual(['지출'])
    expect((await tree())[0]).toEqual(['식비', ['외식', '장보기']])
  })

  it('위 24px, 아래 8px이고 폭은 내용 폭이다', async () => {
    await openList()
    const box = screen.getByRole('radiogroup').parentElement!
    expect(styleOf(box).getPropertyValue('margin-block')).toBe('var(--space-24) var(--space-8)')
    expect(styleOf(screen.getByRole('main')).getPropertyValue('--gutter')).toBe('var(--space-16)')
  })
})

describe('불러오는 중', () => {
  const pass = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))
  const skeleton = () => screen.getByRole('main').querySelector('[aria-hidden="true"]')

  /** 다른 화면에서 시계를 멈추고 카테고리로 간다. 요청은 답을 기다린다. */
  async function openLoading() {
    const answer = delayed()
    api.response = answer.respond
    installMatchMedia(390)
    const { router } = await openApp('/other', addScreens([{ path: '/other', element: <main>다른 화면</main> }]))
    await screen.findByText('다른 화면')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await act(() => router.navigate('/categories'))
    return answer
  }

  it('응답을 기다리지 않고 고르기를 보이고, 그사이 고른 구분의 목록을 보인다', async () => {
    const late = delayed()
    api.response = late.respond
    const { user } = await open()
    await late.arrived
    expect(chosen()).toEqual(['지출'])
    await user.click(option('수입'))
    late.answer(HttpResponse.json({ items }))
    expect((await tree())[0]).toBe('급여')
  })

  it('300ms까지는 고르기만 있고 그 뒤 뼈대를 보이며 "불러오고 있어요."를 알린다', async () => {
    await openLoading()
    await pass(299)
    expect(chosen()).toEqual(['지출'])
    expect(screen.getByRole('main').textContent).toBe('지출수입')
    expect(skeleton()).toBeNull()
    await pass(1)
    expect(content().getByRole('status').textContent).toBe(loading)
    expect(skeleton()).toBeTruthy()
    expect(chosen()).toEqual(['지출'])
    expect(screen.getByRole('heading', { level: 1, name: '카테고리' })).toBeTruthy()
  })

  it('뼈대는 이름 막대만 있는 카테고리 줄 8개이고 화면 읽기에는 없다', async () => {
    await openLoading()
    await pass(300)
    const rows = [...skeleton()!.children]
    expect(rows.map((row) => row.children.length)).toEqual(Array(8).fill(1))
    for (const row of rows) {
      expect(styleOf(row.firstElementChild!).width).toBe('40%')
      expect(styleOf(row.firstElementChild!).font).toBe('var(--text-body)')
    }
    expect(content().queryAllByRole('listitem')).toEqual([])
  })

  it('뼈대 줄은 실제 줄과 같은 CSS를 쓴다', async () => {
    const answer = await openLoading()
    await pass(300)
    const classes = [...skeleton()!.children].map((row) => row.className)
    answer.answer(HttpResponse.json({ items }))
    vi.useRealTimers()
    await list()
    expect(new Set(classes)).toEqual(new Set([rowOf('식비').className]))
  })

  it('받으면 뼈대와 알림을 지우고 목록을 보인다', async () => {
    const answer = await openLoading()
    await pass(300)
    answer.answer(HttpResponse.json({ items }))
    vi.useRealTimers()
    await list()
    expect(content().queryByRole('status')).toBeNull()
    expect(skeleton()).toBeNull()
  })

  it('300ms 안에 받으면 뼈대를 보이지 않는다', async () => {
    const answer = await openLoading()
    const dom = recordDom()
    answer.answer(HttpResponse.json({ items }))
    vi.useRealTimers()
    await list()
    expect(dom.sawText(loading)).toBe(false)
    expect(dom.sawElement('main [aria-hidden="true"]')).toBe(false)
  })
})

describe('오류', () => {
  it.each([
    ['서버 오류', () => problem(500, 'INTERNAL_ERROR')],
    ['거부', () => problem(404, 'NOT_FOUND')],
    ['연결 실패', () => HttpResponse.error()],
    ['약속과 다른 응답', () => HttpResponse.json({ items: [{ ...items[0], kind: 'TRANSFER' }] })],
  ])('%s: 고르기 아래에 안내와 "다시 시도"를 보이고, 누르면 다시 받는다', async (_, response) => {
    api.response = response
    const { user } = await open()
    await failure()
    expect(content().getByText('잠시 후 다시 시도해 주세요.')).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 1 }).map((heading) => heading.textContent)).toEqual(['카테고리'])
    expect(chosen()).toEqual(['지출'])
    expect(content().queryAllByRole('list')).toEqual([])
    respondWith(items)
    await user.click(retry())
    expect((await tree())[0]).toEqual(['식비', ['외식', '장보기']])
    expect(screen.queryByText(failed)).toBeNull()
  })

  it('저절로 다시 받지 않는다', async () => {
    api.response = () => problem(500, 'INTERNAL_ERROR')
    await open()
    await failure()
    await settle()
    expect(api.requests).toHaveLength(1)
  })

  it('다시 받는 동안 안내는 그대로이고 버튼만 처리 중이다', async () => {
    api.response = () => problem(500, 'INTERNAL_ERROR')
    const { user } = await open()
    await failure()
    const late = delayed()
    api.response = late.respond
    await user.click(retry())
    await late.arrived
    expect(retry().getAttribute('aria-busy')).toBe('true')
    expect(await failure()).toBeTruthy()
    late.answer(problem(500, 'INTERNAL_ERROR'))
    await waitFor(() => expect(retry().getAttribute('aria-busy')).toBeNull())
  })

  it('실패한 채 나갔다 다시 들어오면 앞의 안내를 보이지 않고 처음부터 받는다', async () => {
    api.response = () => problem(500, 'INTERNAL_ERROR')
    const { router } = await open('/more')
    await act(() => router.navigate('/categories'))
    await failure()
    await act(() => router.navigate('/more'))
    const late = delayed()
    api.response = late.respond
    const dom = recordDom()
    await act(() => router.navigate('/categories'))
    await late.arrived
    late.answer(HttpResponse.json({ items }))
    await list()
    expect(dom.sawText(failed)).toBe(false)
  })

  it('받은 목록이 있으면 다시 받기가 실패해도 그대로 보인다', async () => {
    const { router } = await open('/more')
    await act(() => router.navigate('/categories'))
    await list()
    await act(() => router.navigate('/more'))
    const late = delayed()
    api.response = late.respond
    await act(() => router.navigate('/categories'))
    await late.arrived
    expect(content().getByText('식비')).toBeTruthy()
    late.answer(problem(500, 'INTERNAL_ERROR'))
    await settle()
    expect(content().getByText('식비')).toBeTruthy()
    expect(screen.queryByText(failed)).toBeNull()
  })
})
