import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryRouter, useLocation, type RouteObject } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { afterEach, describe, expect, it } from 'vitest'
import SwitchRow from '../src/components/SwitchRow'
import { readCssRule } from './support/cssRule'

/*
 * 전환 줄(00-common 5.11, docs/design/components.md 4절). 화면을 옮기는 줄에만 쓴다(designer 결정 2026-11-26, #102).
 * 통계(F-311), 반복 거래와 할부(F-613), 가져오기·내보내기(F-718)가 쓴다. 칸이 하나뿐이면 옮겨 갈 곳이 없어 그리지 않는다
 * (designer #242).
 */

const CSS = 'src/components/SwitchRow.module.css'

function Here() {
  const location = useLocation()
  return <output aria-label="지금 주소">{`${location.pathname}${location.search}`}</output>
}

const statsItems = [
  { label: '월별', to: '/stats/monthly?month=2026-11' },
  { label: '카테고리', to: '/stats/categories?month=2026-11' },
  { label: '연 단위', to: '/stats/yearly?year=2026' },
]

function open(items: { label: string; to: string }[], current: string, path = '/stats/monthly?month=2026-11') {
  const routes: RouteObject[] = [
    {
      path: '*',
      element: (
        <>
          <Here />
          <SwitchRow label="통계 화면" items={items} current={current} />
        </>
      ),
    },
  ]
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}

const row = () => screen.getByRole('navigation', { name: '통계 화면' })
const cells = () => within(row()).getAllByRole('link')
const here = () => screen.getByLabelText('지금 주소').textContent

afterEach(cleanup)

describe('칸이 여럿일 때', () => {
  it('이름을 가진 내비게이션이고 칸마다 글자 하나인 링크를 적은 순서로 둔다', () => {
    open(statsItems, '월별')
    expect(cells().map((cell) => cell.textContent)).toEqual(['월별', '카테고리', '연 단위'])
    expect(cells().map((cell) => cell.getAttribute('href'))).toEqual(statsItems.map(({ to }) => to))
    for (const cell of cells()) expect(cell.querySelector('svg')).toBeNull()
  })

  it('지금 화면의 칸 하나에만 aria-current="page"가 있다', () => {
    open(statsItems, '카테고리')
    expect(cells().map((cell) => cell.getAttribute('aria-current'))).toEqual([null, 'page', null])
  })

  it('다른 칸을 누르면 그 화면으로 옮겨 간다', async () => {
    const router = open(statsItems, '월별')
    await act(async () => {
      fireEvent.click(within(row()).getByRole('link', { name: '연 단위' }))
    })
    expect(here()).toBe('/stats/yearly?year=2026')
    expect(router.state.historyAction).toBe('PUSH')
  })

  it('지금 칸을 누르면 같은 주소로 바꿔 쓰고 방문 기록을 쌓지 않는다', async () => {
    const router = open(statsItems, '월별')
    await act(async () => {
      fireEvent.click(within(row()).getByRole('link', { name: '월별' }))
    })
    expect(here()).toBe('/stats/monthly?month=2026-11')
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it('칸은 높이 44px 이상이고 글자는 보조 글자색 본문, 아래에 투명한 2px 선 자리를 둔다', () => {
    open(statsItems, '월별')
    const cell = getComputedStyle(cells()[1])
    expect(cell.minHeight).toBe('var(--size-touch)')
    expect(cell.color).toBe('var(--color-text-secondary)')
    expect(cell.font).toBe('var(--text-body)')
    expect(readCssRule(CSS, '.cell')).toContain('border-bottom: var(--border-width-strong) solid transparent;')
  })

  it('고른 칸은 강조색 글자와 아래 2px 강조색 선이고 굵기는 바꾸지 않는다', () => {
    open(statsItems, '월별')
    const chosen = getComputedStyle(cells()[0])
    expect(chosen.color).toBe('var(--color-accent)')
    expect(chosen.borderBottomColor).toBe('var(--color-accent)')
    expect(readCssRule(CSS, '.cell[aria-current="page"]')).not.toMatch(/font/)
  })

  it('칸이 줄 폭을 넘으면 칸을 줄이거나 줄을 바꾸지 않고 줄을 가로로 밀어 본다', () => {
    open(statsItems, '월별')
    const list = getComputedStyle(within(row()).getByRole('list'))
    expect(list.display).toBe('flex')
    expect(list.overflowX).toBe('auto')
    expect(readCssRule(CSS, '.cell')).toContain('white-space: nowrap;')
    expect(readCssRule(CSS, '.list > li')).toContain('flex: none;')
  })

  it('밀어 보는 줄 안에서 잘리지 않도록 초점 테두리는 칸 안쪽에 그린다', () => {
    expect(readCssRule(CSS, '.cell:focus-visible')).toContain('outline-offset: calc(-1 * var(--focus-ring-width));')
  })

  it('누를 때 100ms 동안 0.98로 줄어든다(2.6)', () => {
    expect(readCssRule(CSS, '.cell')).toContain('transition: transform var(--motion-press-duration);')
    expect(readCssRule(CSS, '.cell:active')).toContain('transform: scale(var(--motion-press-scale));')
  })
})

describe('칸이 하나뿐일 때', () => {
  it('옮겨 갈 곳이 없으므로 줄을 그리지 않는다(designer #242)', () => {
    open([statsItems[0]], '월별')
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('칸이 없어도 그리지 않는다', () => {
    open([], '월별')
    expect(screen.queryByRole('navigation')).toBeNull()
  })
})
