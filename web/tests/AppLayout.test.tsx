import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { Link, type RouteObject } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AppLayout from '../src/app/AppLayout'
import type { MainNavigationItem, Navigation, NavigationItem } from '../src/app/navigation'
import { MainScreen, SubScreen } from '../src/components/Screen'
import { readCssRule } from './support/cssRule'
import { renderRoutes } from './support/renderRoutes'
import { resetViewport, setViewportWidth } from './support/viewport'
import { readWebFile } from './support/webFile'

// 틀이 쓰는 모양만 확인하려고 넣은 항목이다. 실제 항목은 각 화면 이슈가 app/navigation.ts에 더한다.
const home: MainNavigationItem = { label: '홈', to: '/home', icon: 'Eye' }
const transactions: MainNavigationItem = { label: '내역', to: '/transactions', icon: 'Check' }
const more: MainNavigationItem = { label: '더보기', to: '/more', icon: 'Plus' }
const accounts: NavigationItem = { label: '계좌', to: '/accounts' }
const trash: NavigationItem = { label: '휴지통', to: '/trash' }

const navigation: Navigation = {
  tabs: [home, transactions, more],
  fallbackTab: more,
  sidebar: { main: [home, transactions], more: [accounts, trash] },
}

const links = (
  <>
    <Link to="/transactions/7">거래 7</Link>
    <Link to="/transactions/7/history">변경 이력</Link>
    <Link to="/home">홈 화면</Link>
    <Link to="/accounts">계좌 화면</Link>
  </>
)

function routesWith(ledgerName?: string): RouteObject[] {
  const main = (name: string) => <MainScreen>{[<p key="name">{name} 내용</p>, <div key="links">{links}</div>]}</MainScreen>
  const sub = (title: string, parent: string) => (
    <SubScreen title={title} parent={parent}>
      {links}
    </SubScreen>
  )
  return [
    {
      element: <AppLayout navigation={navigation} ledgerName={ledgerName} />,
      children: [
        { path: '/home', element: main('홈'), handle: { navigationItem: home } },
        {
          handle: { navigationItem: transactions },
          children: [
            { path: '/transactions', element: main('내역') },
            { path: '/transactions/:id', element: sub('거래 상세', '/transactions') },
            { path: '/transactions/:id/history', element: sub('변경 이력', '/transactions') },
          ],
        },
        { path: '/more', element: main('더보기'), handle: { navigationItem: more } },
        { path: '/accounts', element: sub('계좌', '/more'), handle: { navigationItem: accounts } },
        { path: '*', element: main('없음') },
      ],
    },
  ]
}

function open(path: string, { width = 390, ledgerName }: { width?: number; ledgerName?: string } = {}) {
  const router = renderRoutes(routesWith(ledgerName), path)
  setViewportWidth(width)
  return router
}

const menu = () => screen.getByRole('navigation', { name: '주 메뉴' })
const menuNames = () => within(menu()).getAllByRole('link').map((link) => link.textContent)
const menuLink = (name: string) => within(menu()).getByRole('link', { name })
const currentNames = () =>
  within(menu())
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page')
    .map((link) => link.textContent)
const contentLink = (name: string) => within(screen.getByRole('main')).getByRole('link', { name })
const styleOf = (element: Element) => getComputedStyle(element)

const scrollTo = vi.fn()
beforeEach(() => {
  scrollTo.mockClear()
  vi.stubGlobal('scrollTo', scrollTo)
})

afterEach(() => {
  cleanup()
  resetViewport()
  vi.unstubAllGlobals()
})

describe('화면 폭에 따른 배치', () => {
  it.each([320, 390, 767])('%dpx은 상단 바와 하단 탭이고 내용 폭을 제한하지 않는다', (width) => {
    open('/home', { width })
    expect(menuNames()).toEqual(['홈', '내역', '더보기'])
    expect(screen.getByRole('banner')).toBeTruthy()
    for (const area of [screen.getByRole('main'), screen.getByRole('banner'), within(menu()).getByRole('list')]) {
      expect(styleOf(area).getPropertyValue('--content-width')).toBe('100%')
      expect(styleOf(area).getPropertyValue('--gutter')).toBe('var(--space-16)')
    }
  })

  it.each([768, 1023])('%dpx은 같은 배치에서 상단 바와 하단 탭의 항목, 내용을 가운데 640px에 둔다', (width) => {
    open('/home', { width })
    expect(menuNames()).toEqual(['홈', '내역', '더보기'])
    expect(screen.getByRole('banner')).toBeTruthy()
    for (const area of [screen.getByRole('main'), screen.getByRole('banner'), within(menu()).getByRole('list')]) {
      expect(styleOf(area).getPropertyValue('--content-width')).toBe('var(--width-content-narrow)')
    }
  })

  it.each([1024, 1280])('%dpx은 왼쪽 사이드바 240px이고 상단 바가 없으며 내용은 가운데 720px이다', (width) => {
    open('/home', { width })
    expect(menuNames()).toEqual(['홈', '내역', '계좌', '휴지통'])
    expect(styleOf(menu().parentElement!).width).toBe('var(--width-sidebar)')
    expect(screen.queryByRole('banner')).toBeNull()
    const main = styleOf(screen.getByRole('main'))
    expect(main.getPropertyValue('--content-width')).toBe('var(--width-content-wide)')
    expect(main.getPropertyValue('--gutter')).toBe('var(--space-24)')
  })

  it.each([390, 768, 1280])('%dpx에서 내용 폭은 좌우 여백으로 만들어 바탕은 전체 폭이다', (width) => {
    open('/home', { width })
    const padding = styleOf(screen.getByRole('main')).getPropertyValue('padding-inline')
    expect(padding).toContain('(100% - var(--content-width)) / 2')
    expect(padding).toContain('var(--gutter)')
  })

  it('상단 바와 하단 탭은 스크롤해도 늘 보인다', () => {
    open('/home')
    expect(styleOf(screen.getByRole('banner')).position).toBe('sticky')
    expect(styleOf(screen.getByRole('banner')).top).toBe('0px')
    expect(styleOf(menu()).position).toBe('sticky')
    expect(styleOf(menu()).bottom).toBe('0px')
  })

  it('내용 아래 여백은 24px이다', () => {
    open('/home')
    expect(styleOf(screen.getByRole('main')).paddingBottom).toBe('var(--space-24)')
  })
})

describe('안전 영역', () => {
  it('상단 바와 하단 탭은 56px에 안전 영역을 더한 높이이고 그만큼 안쪽 여백을 둔다', () => {
    open('/home')
    expect(styleOf(screen.getByRole('banner')).minHeight).toBe(
      'calc(var(--size-topbar) + env(safe-area-inset-top))',
    )
    expect(readCssRule('src/components/Screen.module.css', '.topBar')).toContain(
      'padding-block: env(safe-area-inset-top) 0;',
    )
    expect(styleOf(menu()).minHeight).toBe('calc(var(--size-tabbar) + env(safe-area-inset-bottom))')
    expect(readCssRule('src/app/TabBar.module.css', '.tabBar')).toContain(
      'padding-block: 0 env(safe-area-inset-bottom);',
    )
  })

  it.each([390, 768, 1280])('%dpx에서 좌우 여백은 좌우 안전 영역보다 좁아지지 않는다', (width) => {
    open('/home', { width })
    const padding = styleOf(screen.getByRole('main')).getPropertyValue('padding-inline')
    expect(padding).toContain('env(safe-area-inset-left)')
    expect(padding).toContain('env(safe-area-inset-right)')
  })

  it('넓은 화면은 바가 없으므로 내용과 사이드바가 위아래 안전 영역을 피한다', () => {
    open('/home', { width: 1280 })
    const wide = readWebFile('src/app/AppLayout.module.css').split('@media (width >= 1024px)')[1]
    expect(wide).toContain('padding-block: env(safe-area-inset-top) env(safe-area-inset-bottom);')
    expect(styleOf(menu().parentElement!).getPropertyValue('padding-block')).toBe(
      'max(var(--space-24), env(safe-area-inset-top)) max(var(--space-24), env(safe-area-inset-bottom))',
    )
  })
})

describe('상단 바', () => {
  it('기본 형태는 장부 이름을 글자로만 보여 준다', () => {
    open('/home', { ledgerName: '내 가계부' })
    const bar = within(screen.getByRole('banner'))
    expect(bar.getByText('내 가계부')).toBeTruthy()
    expect(bar.queryByRole('button')).toBeNull()
    expect(bar.queryByRole('link')).toBeNull()
  })

  it('장부 이름은 text-body-strong 한 줄이고 넘치면 말줄임표로 줄인다', () => {
    open('/home', { ledgerName: '내 가계부' })
    const name = styleOf(within(screen.getByRole('banner')).getByText('내 가계부'))
    expect(name.font).toBe('var(--text-body-strong)')
    expect(name.whiteSpace).toBe('nowrap')
    expect(name.textOverflow).toBe('ellipsis')
    expect(name.overflow).toBe('hidden')
  })

  it('장부 이름을 아직 받지 못했으면 비워 두고 높이는 그대로다', () => {
    open('/home')
    expect(screen.getByRole('banner').textContent).toBe('')
    expect(styleOf(screen.getByRole('banner')).minHeight).toContain('var(--size-topbar)')
  })

  it('하위 화면 형태는 "뒤로"와 화면 이름을 보여 주고 장부 이름은 없다', () => {
    open('/accounts', { ledgerName: '내 가계부' })
    const bar = within(screen.getByRole('banner'))
    expect(bar.getByRole('button', { name: '뒤로' })).toBeTruthy()
    expect(bar.getByRole('heading', { level: 1, name: '계좌' })).toBeTruthy()
    expect(bar.queryByText('내 가계부')).toBeNull()
  })

  it('하위 화면의 하단 탭은 그대로 보인다', () => {
    open('/accounts')
    expect(menuNames()).toEqual(['홈', '내역', '더보기'])
  })

  it('하위 화면 이름은 한 줄이고 넘치면 말줄임표로 줄인다', () => {
    open('/accounts')
    const title = styleOf(screen.getByRole('heading', { level: 1, name: '계좌' }))
    expect(title.whiteSpace).toBe('nowrap')
    expect(title.textOverflow).toBe('ellipsis')
    expect(title.overflow).toBe('hidden')
  })

  it('넓은 화면의 하위 화면은 바탕과 선이 없는 줄로 내용 맨 위에 "뒤로"와 화면 이름을 둔다', () => {
    open('/accounts', { width: 1280, ledgerName: '내 가계부' })
    const row = screen.getByRole('banner')
    expect(within(row).getByRole('button', { name: '뒤로' })).toBeTruthy()
    expect(within(row).getByRole('heading', { level: 1, name: '계좌' })).toBeTruthy()
    expect(styleOf(row).position).toBe('static')
    expect(styleOf(row).backgroundColor.replace('rgba(0, 0, 0, 0)', 'transparent')).toBe('transparent')
    expect(styleOf(row).getPropertyValue('--content-width')).toBe('var(--width-content-wide)')
  })
})

describe('사이드바', () => {
  const wide = { width: 1280 }

  it('맨 위에 장부 이름을 글자로 보여 준다', () => {
    open('/home', { ...wide, ledgerName: '내 가계부' })
    const name = within(menu().parentElement!).getByText('내 가계부')
    expect(name.closest('a, button')).toBeNull()
    expect(styleOf(name).font).toBe('var(--text-body-strong)')
  })

  it('주 메뉴는 24px 아이콘과 이름(사이 12px), 더보기 항목은 이름만 두고 줄 높이는 44px, 글자는 text-body다', () => {
    open('/home', wide)
    expect(menuLink('홈').querySelectorAll('svg')).toHaveLength(1)
    expect(styleOf(menuLink('홈').querySelector('svg')!).width).toBe('var(--size-icon-24)')
    expect(styleOf(menuLink('홈')).gap).toBe('var(--space-12)')
    expect(menuLink('계좌').querySelectorAll('svg')).toHaveLength(0)
    for (const name of ['홈', '계좌']) {
      expect(styleOf(menuLink(name)).minHeight).toBe('var(--size-touch)')
      expect(styleOf(menuLink(name)).font).toBe('var(--text-body)')
    }
  })

  it('주 메뉴와 더보기 항목 사이를 1px 선으로 나눈다', () => {
    open('/home', wide)
    const [main, rest] = within(menu()).getAllByRole('list')
    expect(within(main).getAllByRole('link')).toHaveLength(2)
    expect(within(rest).getAllByRole('link')).toHaveLength(2)
    expect(rest.className).not.toBe(main.className)
    expect(readCssRule('src/app/Sidebar.module.css', '.more')).toContain('border-top: 1px solid var(--color-border)')
  })

  it('창 높이가 모자라면 사이드바 안에서 스크롤한다', () => {
    open('/home', wide)
    const sidebar = styleOf(menu().parentElement!)
    expect(sidebar.height).toBe('100dvh')
    expect(sidebar.overflowY).toBe('auto')
    expect(sidebar.position).toBe('sticky')
  })

  it('지금 화면에 해당하는 항목 하나만 강조한다', () => {
    open('/accounts', wide)
    expect(currentNames()).toEqual(['계좌'])
  })

  it('들어온 곳과 상관없이 지금 화면에 해당하는 항목을 강조한다', async () => {
    open('/home', wide)
    fireEvent.click(contentLink('거래 7'))
    await screen.findByRole('heading', { name: '거래 상세' })
    expect(currentNames()).toEqual(['내역'])
  })

  it('해당하는 항목이 없는 화면에서는 강조하지 않는다', () => {
    open('/없는-주소', wide)
    expect(currentNames()).toEqual([])
  })
})

describe('하단 탭', () => {
  it('적은 순서대로 같은 폭의 칸에 24px 아이콘과 이름(text-caption)을 둔다', () => {
    open('/home')
    const list = within(menu()).getByRole('list')
    expect(styleOf(list).display).toBe('grid')
    expect(styleOf(list).gridAutoFlow).toBe('column')
    expect(styleOf(list).gridAutoColumns).toBe('minmax(0, 1fr)')
    for (const link of within(menu()).getAllByRole('link')) {
      expect(styleOf(link).font).toBe('var(--text-caption)')
      expect(styleOf(link.querySelector('svg')!).width).toBe('var(--size-icon-24)')
      // 본문의 낱말 단위 줄바꿈(keep-all)에서도 글자를 키우면 칸 안에서 줄을 바꾼다.
      expect(styleOf(link).overflowWrap).toBe('anywhere')
    }
  })

  it('고른 탭은 색만 바뀌고 아이콘과 글자 굵기는 그대로다', () => {
    const iconOf = (name: string) => menuLink(name).querySelector('svg')!.innerHTML
    open('/home')
    const current = iconOf('홈')
    expect(styleOf(menuLink('홈')).color).toBe('var(--color-accent)')
    expect(styleOf(menuLink('내역')).color).toBe('var(--color-text-secondary)')
    cleanup()
    open('/transactions')
    expect(iconOf('홈')).toBe(current)
    expect(styleOf(menuLink('홈')).color).toBe('var(--color-text-secondary)')
    expect(styleOf(menuLink('홈')).font).toBe('var(--text-caption)')
  })

  it('항목이 하나도 없어도 틀은 그린다', () => {
    const empty: Navigation = { tabs: [], sidebar: { main: [], more: [] } }
    renderRoutes(
      [{ element: <AppLayout navigation={empty} />, children: [{ path: '/', element: <MainScreen>내용</MainScreen> }] }],
      '/',
    )
    expect(within(menu()).queryAllByRole('link')).toEqual([])
    setViewportWidth(1280)
    expect(within(menu()).queryAllByRole('list')).toEqual([])
  })
})

describe('강조할 탭', () => {
  it.each([
    ['/home', '홈'],
    ['/transactions', '내역'],
    ['/transactions/7', '내역'],
    ['/more', '더보기'],
    ['/accounts', '더보기'],
    ['/없는-주소', '더보기'],
    ['/transactions/1/2/3', '더보기'],
  ])('주소 %s를 바로 열면 화면이 속한 "%s" 하나만 강조한다', (path, name) => {
    open(path)
    expect(currentNames()).toEqual([name])
  })

  it('다른 탭에서 들어온 화면은 들어온 탭을 강조한다', async () => {
    open('/home')
    fireEvent.click(contentLink('거래 7'))
    await screen.findByRole('heading', { name: '거래 상세' })
    expect(currentNames()).toEqual(['홈'])
    fireEvent.click(contentLink('변경 이력'))
    await screen.findByRole('heading', { name: '변경 이력' })
    expect(currentNames()).toEqual(['홈'])
  })

  it('하위 화면에서 다른 탭의 첫 화면으로 가면 그 탭을 강조한다', async () => {
    open('/없는-주소')
    fireEvent.click(contentLink('홈 화면'))
    await screen.findByText('홈 내용')
    expect(currentNames()).toEqual(['홈'])
  })

  it('뒤로 돌아오면 그 화면에 처음 들어왔을 때의 탭을 강조한다', async () => {
    const router = open('/home')
    fireEvent.click(contentLink('거래 7'))
    await screen.findByRole('heading', { name: '거래 상세' })
    fireEvent.click(menuLink('내역'))
    await screen.findByText('내역 내용')
    fireEvent.click(contentLink('거래 7'))
    await screen.findByRole('heading', { name: '거래 상세' })
    expect(currentNames()).toEqual(['내역'])

    await router.navigate(-2)
    await vi.waitFor(() => expect(currentNames()).toEqual(['홈']))
    await router.navigate(2)
    await vi.waitFor(() => expect(currentNames()).toEqual(['내역']))
  })
})

describe.each([
  ['하단 탭', 390],
  ['사이드바', 1280],
])('%s에서 지금 항목을 다시 누르면', (_, width) => {
  it('하위 화면이면 그 항목의 첫 화면으로 간다', async () => {
    const router = open('/transactions/7', { width })
    fireEvent.click(menuLink('내역'))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
  })

  it('이미 첫 화면이면 주소는 그대로 두고 맨 위로 스크롤한다', () => {
    const router = open('/transactions?month=2026-10', { width })
    const key = router.state.location.key
    const left = fireEvent.click(menuLink('내역'))
    expect(left).toBe(false)
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith(0, 0)
    expect(router.state.location.key).toBe(key)
    expect(router.state.location.search).toBe('?month=2026-10')
  })

  it('다른 항목을 누르면 그 항목의 첫 화면으로 간다', async () => {
    const router = open('/transactions/7', { width })
    fireEvent.click(menuLink('홈'))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/home'))
    expect(currentNames()).toEqual(['홈'])
  })

  it.each(['metaKey', 'ctrlKey', 'shiftKey'])('새 창으로 여는 누르기(%s)는 브라우저에 맡긴다', (modifier) => {
    const router = open('/home', { width })
    const key = router.state.location.key
    let handledByApp: boolean | undefined
    window.addEventListener(
      'click',
      (event) => {
        handledByApp = event.defaultPrevented
        event.preventDefault() // jsdom은 새 창을 열지 못한다.
      },
      { once: true },
    )
    fireEvent.click(menuLink('홈'), { [modifier]: true })
    expect(handledByApp).toBe(false)
    expect(scrollTo).not.toHaveBeenCalled()
    expect(router.state.location.key).toBe(key)
  })
})
