import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ListButton, ListGroup, ListLink } from '../src/components/ListRow'
import { Info, SignOut } from '../src/components/icons'
import { readCssRule } from './support/cssRule'
import { resetViewport, setViewportWidth } from './support/viewport'
import { readWebFile } from './support/webFile'

const CSS = 'src/components/ListRow.module.css'

function renderRows(onClick = () => {}) {
  render(
    <MemoryRouter>
      <ListGroup>
        <ListLink icon={Info} to="/accounts">
          계좌
        </ListLink>
      </ListGroup>
      <ListGroup>
        <ListButton icon={SignOut} onClick={onClick}>
          로그아웃
        </ListButton>
      </ListGroup>
    </MemoryRouter>,
  )
  return { link: screen.getByRole('link', { name: '계좌' }), button: screen.getByRole('button', { name: '로그아웃' }) }
}

/** 글자 앞뒤의 아이콘 */
const iconsOf = (row: HTMLElement) => [...row.querySelectorAll('svg')]

afterEach(() => {
  cleanup()
  resetViewport()
})

describe('목록 줄', () => {
  it('이동은 링크, 동작은 버튼이고 묶음의 목록에 든다', () => {
    const { link, button } = renderRows()
    expect(link.getAttribute('href')).toBe('/accounts')
    expect(button.getAttribute('type')).toBe('button')
    expect(screen.getAllByRole('list')).toHaveLength(2)
    expect(screen.getAllByRole('listitem').map((item) => item.firstElementChild)).toEqual([link, button])
  })

  it('버튼을 누르면 동작한다', () => {
    const onClick = vi.fn()
    fireEvent.click(renderRows(onClick).button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('이동하는 줄에만 오른쪽에 화살표가 있다', () => {
    const { link, button } = renderRows()
    expect(iconsOf(link)).toHaveLength(2)
    expect(iconsOf(button)).toHaveLength(1)
    expect(link.lastElementChild!.contains(iconsOf(link)[1])).toBe(true)
  })

  it('아이콘은 모두 20px 보조 글자색이고 장식이다', () => {
    const { link, button } = renderRows()
    for (const icon of [...iconsOf(link), ...iconsOf(button)]) {
      expect(getComputedStyle(icon).width).toBe('var(--size-icon-20)')
      expect(getComputedStyle(icon.parentElement!).color).toBe('var(--color-text-secondary)')
      expect(icon.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('높이 56px 이상, 좌우 16px, 위아래 8px, 아이콘과 이름 사이 12px, 글자는 본문이고 줄 전체를 누를 수 있다', () => {
    const rows = renderRows()
    for (const row of Object.values(rows)) {
      const style = getComputedStyle(row)
      expect(style.minHeight).toBe('var(--size-row)')
      expect(style.getPropertyValue('padding-block')).toBe('var(--space-8)')
      expect(style.getPropertyValue('padding-inline')).toBe('var(--space-16)')
      expect(style.gap).toBe('var(--space-12)')
      expect(style.font).toBe('var(--text-body)')
      expect(style.color).toBe('var(--color-text)')
      expect(style.display).toBe('flex')
      expect(style.width).toBe('100%')
    }
  })

  it('이름이 남는 폭을 채워 화살표가 오른쪽 끝에 놓이고, 길면 줄을 바꾼다', () => {
    const { link } = renderRows()
    const name = screen.getByText('계좌')
    expect(getComputedStyle(name).flex).toBe('1 1 0%')
    expect(getComputedStyle(name).minWidth).toBe('0px')
    expect(getComputedStyle(name).whiteSpace).not.toBe('nowrap')
    expect(getComputedStyle(link.lastElementChild!).flex).toBe('0 0 auto')
  })

  it('바탕과 테두리, 모서리가 없고 줄 사이에 선이 없다', () => {
    const rows = renderRows()
    for (const row of Object.values(rows)) {
      const style = getComputedStyle(row)
      expect(style.backgroundColor.replace('rgba(0, 0, 0, 0)', 'transparent')).toBe('transparent')
      expect(style.borderTopWidth.replace('medium', '0px')).toMatch(/^0(px)?$/)
      expect(style.borderRadius).toBe('0px')
    }
  })

  it('누르는 동안과 마우스를 올린 동안 color-press 바탕이다. 손가락으로 누른 뒤에는 남지 않는다', () => {
    expect(readCssRule(CSS, '.row:active')).toContain('background-color: var(--color-press)')
    expect(readWebFile(CSS)).toMatch(
      /@media \(hover: hover\) \{\s*\.row:hover \{\s*background-color: var\(--color-press\);\s*\}\s*\}/,
    )
  })

  it('줄은 화면 끝까지 닿으므로 키보드 초점 테두리를 잘리지 않게 안쪽에 그린다', () => {
    expect(readCssRule(CSS, '.row:focus-visible')).toContain('outline-offset: calc(-1 * var(--focus-ring-width))')
  })

  it.each([320, 390, 767])('폭 %dpx에서는 줄의 바탕과 묶음 사이의 선이 화면 끝까지 닿는다', (width) => {
    renderRows()
    setViewportWidth(width)
    const [group] = screen.getAllByRole('list')
    const [item] = screen.getAllByRole('listitem')
    expect(getComputedStyle(group).getPropertyValue('margin-inline')).toBe('calc(-1 * var(--space-16))')
    expect(getComputedStyle(item).getPropertyValue('margin-inline')).not.toContain('var(--space-16)')
  })

  it.each([768, 1024, 1280])('폭 %dpx에서는 선이 내용 폭에 맞고 줄의 바탕만 좌우 16px 넓다', (width) => {
    renderRows()
    setViewportWidth(width)
    const [group] = screen.getAllByRole('list')
    const [item] = screen.getAllByRole('listitem')
    expect(getComputedStyle(group).getPropertyValue('margin-inline')).toBe('0px')
    expect(getComputedStyle(item).getPropertyValue('margin-inline')).toBe('calc(-1 * var(--space-16))')
  })

  it('묶음이 이어질 때만 사이에 1px 선을 긋고 선 위아래를 24px 띄운다', () => {
    renderRows()
    const [first, second] = screen.getAllByRole('list').map((group) => getComputedStyle(group))
    expect(second.marginTop).toBe('var(--space-24)')
    expect(second.paddingTop).toBe('var(--space-24)')
    expect(first.marginTop).not.toBe('var(--space-24)')
    expect(first.paddingTop).not.toBe('var(--space-24)')
    expect(readCssRule(CSS, '.group + .group')).toContain('border-top: 1px solid var(--color-border)')
  })
})
