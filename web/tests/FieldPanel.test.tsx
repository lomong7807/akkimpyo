import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FieldPanel from '../src/components/FieldPanel'
import { readCssRule } from './support/cssRule'

const rule = (selector: string) => readCssRule('src/components/FieldPanel.module.css', selector)

const WINDOW_HEIGHT = window.innerHeight

function Sample() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <>
      <button type="button" data-testid="칸" onClick={(event) => setAnchor(event.currentTarget)}>
        칸
      </button>
      {anchor && (
        <FieldPanel label="기준일" anchor={anchor} onClose={() => setAnchor(null)}>
          <p>판의 내용</p>
          <button type="button">안의 버튼</button>
        </FieldPanel>
      )}
    </>
  )
}

const field = () => screen.getByTestId('칸')
const dialog = () => screen.queryByRole<HTMLDialogElement>('dialog')
const panel = () => dialog()!.firstElementChild as HTMLElement

/** 칸이 화면의 `top`부터 48px 높이로 `left`에 있다. */
function fieldAt(top: number, left = 480) {
  vi.spyOn(field(), 'getBoundingClientRect').mockReturnValue(new DOMRect(left, top, 560, 48))
}

/** 판의 내용이 `height`일 때 정해진 쪽의 남은 자리만큼 판이 줄어드는 것을 흉내 낸다. */
function panelContent(height: number, room: () => number) {
  vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(height)
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(() => Math.min(height, room()))
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('펼친 판', () => {
  it('이름이 칸 이름인 대화 상자이고 머리, 손잡이, 닫기가 없다', async () => {
    const user = userEvent.setup()
    render(<Sample />)
    await user.click(field())
    expect(screen.getByRole('dialog', { name: '기준일' })).toBeTruthy()
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.queryByRole('button', { name: '닫기' })).toBeNull()
    expect(dialog()!.querySelector('[class*="handle"]')).toBeNull()
  })

  it.each([
    ['바깥 누르기', async (user: ReturnType<typeof userEvent.setup>) => user.click(dialog()!)],
    ['Esc', async (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{Escape}')],
  ])('%s로 닫히고 초점이 칸으로 돌아간다', async (_, close) => {
    const user = userEvent.setup()
    render(<Sample />)
    await user.click(field())
    await close(user)
    await act(async () => {})
    expect(document.querySelector('dialog')).toBeNull()
    expect(document.activeElement).toBe(field())
  })

  it('안을 눌러서는 닫히지 않는다', async () => {
    const user = userEvent.setup()
    render(<Sample />)
    await user.click(field())
    await user.click(screen.getByText('판의 내용'))
    expect(dialog()?.open).toBe(true)
  })
})

describe('자리', () => {
  async function open(top: number, contentHeight: number, left?: number) {
    const user = userEvent.setup()
    render(<Sample />)
    fieldAt(top, left)
    panelContent(contentHeight, () => {
      const { bottom } = field().getBoundingClientRect()
      return panel().dataset.side === 'above' ? top : WINDOW_HEIGHT - bottom
    })
    await user.click(field())
  }

  it('칸의 왼쪽과 위아래 끝을 CSS에 넘긴다', async () => {
    await open(100, 390)
    expect(panel().style.getPropertyValue('--field-left')).toBe('480px')
    expect(panel().style.getPropertyValue('--field-top')).toBe('100px')
    expect(panel().style.getPropertyValue('--field-bottom')).toBe('148px')
  })

  it('아래에 자리가 있으면 아래에 펼친다', async () => {
    await open(100, 390)
    expect(panel().dataset.side).toBe('below')
  })

  it('아래에 자리가 없으면 위로 펼친다', async () => {
    await open(WINDOW_HEIGHT - 148, 390)
    expect(panel().dataset.side).toBe('above')
  })

  it('위아래 모두 모자라면 더 넓은 쪽에 펼친다', async () => {
    await open(200, 2000)
    expect(panel().dataset.side).toBe('below')
    cleanup()
    vi.restoreAllMocks()
    await open(500, 2000)
    expect(panel().dataset.side).toBe('above')
  })

  it('창 크기가 바뀌면 다시 놓는다', async () => {
    await open(100, 390)
    vi.mocked(field().getBoundingClientRect).mockReturnValue(new DOMRect(300, WINDOW_HEIGHT - 148, 560, 48))
    fireEvent(window, new Event('resize'))
    expect(panel().style.getPropertyValue('--field-left')).toBe('300px')
    expect(panel().style.getPropertyValue('--field-bottom')).toBe(`${WINDOW_HEIGHT - 100}px`)
  })

  it('닫은 뒤에는 창 크기를 보지 않는다', async () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const user = userEvent.setup()
    await open(100, 390)
    await user.keyboard('{Escape}')
    expect(remove.mock.calls.some(([type]) => type === 'resize')).toBe(true)
  })

  it('칸과 4px 떨어지고 남은 높이 안에서 스크롤한다', () => {
    expect(rule('.panel')).toContain('overflow-y: auto')
    expect(rule(".panel[data-side='below']")).toContain('top: calc(var(--field-bottom) + var(--space-4))')
    expect(rule(".panel[data-side='below']")).toContain('max-height: calc(100% - var(--field-bottom) - var(--space-4))')
    expect(rule(".panel[data-side='above']")).toContain('bottom: calc(100% - var(--field-top) + var(--space-4))')
    expect(rule(".panel[data-side='above']")).toContain('max-height: calc(var(--field-top) - var(--space-4))')
  })

  it('칸의 왼쪽에 맞추되 화면 오른쪽으로 넘치지 않는다', () => {
    expect(rule('.panel')).toContain('left: min(var(--field-left), 100% - var(--width-field-panel))')
  })
})

describe('모양', () => {
  it('폭 320px, 모서리 12px, 펼친 판 그림자이고 가림막이 없다', async () => {
    const user = userEvent.setup()
    render(<Sample />)
    await user.click(field())
    const style = getComputedStyle(panel())
    expect(style.width).toBe('var(--width-field-panel)')
    expect(style.borderRadius).toBe('var(--radius-12)')
    expect(style.boxShadow).toBe('var(--shadow-dialog)')
    expect(style.backgroundColor).toBe('var(--color-surface)')
    expect(getComputedStyle(dialog()!).backgroundColor).not.toBe('var(--color-scrim)')
  })

  it('안쪽 여백은 위 4px, 아래 8px이다. 좌우 4px은 달력이 둔다', () => {
    expect(rule('.panel')).toContain('padding-block: var(--space-4) var(--space-8)')
    expect(rule('.panel')).not.toContain('padding-inline')
  })

  it('움직임이 없다', () => {
    expect(rule('.panel')).not.toMatch(/animation|transition/)
  })
})
