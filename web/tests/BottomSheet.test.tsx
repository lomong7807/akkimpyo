import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BottomSheet from '../src/components/BottomSheet'
import { readCssRule } from './support/cssRule'

const overlayRule = (selector: string) => readCssRule('src/components/Overlay.module.css', selector)
const rule = (selector: string) => readCssRule('src/components/BottomSheet.module.css', selector)

function Sample() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        열기
      </button>
      <BottomSheet title="기준일" open={open} onClose={() => setOpen(false)}>
        <p>시트의 내용</p>
        <button type="button" onClick={() => setOpen(false)}>
          고르기
        </button>
      </BottomSheet>
    </>
  )
}

const dialog = () => screen.queryByRole<HTMLDialogElement>('dialog')
const opener = () => screen.getByText('열기')

async function openSheet() {
  const user = userEvent.setup()
  render(<Sample />)
  await user.click(opener())
  return user
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('여는 것', () => {
  it('열기 전에는 아무것도 그리지 않는다', () => {
    render(<Sample />)
    expect(document.querySelector('dialog')).toBeNull()
    expect(screen.queryByText('시트의 내용')).toBeNull()
  })

  it('제목이 이름인 모달 대화 상자로 연다', async () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal')
    await openSheet()
    const opened = screen.getByRole('dialog', { name: '기준일' })
    expect(opened.getAttribute('aria-modal')).toBe('true')
    expect(showModal.mock.contexts).toEqual([opened])
    expect(screen.getByRole('heading', { name: '기준일' })).toBeTruthy()
    expect(screen.getByText('시트의 내용')).toBeTruthy()
  })

  it('두 번 그리는 개발 모드에서도 열린 채로 있다', async () => {
    const user = userEvent.setup()
    render(
      <StrictMode>
        <Sample />
      </StrictMode>,
    )
    await user.click(opener())
    await act(async () => {})
    expect(dialog()?.open).toBe(true)
  })
})

describe('닫는 것', () => {
  it.each([
    ['X', async (user) => user.click(screen.getByRole('button', { name: '닫기' }))],
    ['가림막', async (user) => user.click(dialog()!)],
    ['Esc', async (user) => user.keyboard('{Escape}')],
    ['안의 동작', async (user) => user.click(screen.getByRole('button', { name: '고르기' }))],
    // 브라우저가 cancel을 막지 못하게 하고 닫는 경우(사용자 동작 없이 Esc를 두 번 누른 때)
    ['브라우저', async () => act(async () => dialog()!.close())],
  ] as [string, (user: ReturnType<typeof userEvent.setup>) => Promise<unknown>][])(
    '%s로 닫으면 사라지고 초점이 연 버튼으로 돌아간다',
    async (_, close) => {
      const user = await openSheet()
      await close(user)
      await act(async () => {})
      expect(document.querySelector('dialog')).toBeNull()
      expect(document.activeElement).toBe(opener())
    },
  )

  it('닫은 뒤 다시 열 수 있다', async () => {
    const user = await openSheet()
    await user.keyboard('{Escape}')
    await user.click(opener())
    expect(dialog()?.open).toBe(true)
  })

  it('시트 안을 눌러서는 닫히지 않는다', async () => {
    const user = await openSheet()
    await user.click(screen.getByText('시트의 내용'))
    await user.click(screen.getByRole('heading', { name: '기준일' }))
    expect(dialog()?.open).toBe(true)
  })

  it('안에서 눌러 밖에서 떼거나 밖에서 눌러 안에서 떼면 닫히지 않는다', async () => {
    await openSheet()
    const inside = screen.getByText('시트의 내용')
    fireEvent.pointerDown(inside)
    fireEvent.click(dialog()!)
    expect(dialog()?.open).toBe(true)
    fireEvent.pointerDown(dialog()!)
    fireEvent.click(inside)
    expect(dialog()?.open).toBe(true)
  })

  it('열린 채 화면에서 빠져도 초점이 연 버튼으로 돌아간다', async () => {
    const user = userEvent.setup()
    function Leaving() {
      const [left, setLeft] = useState(false)
      return (
        <>
          <button type="button">밖의 버튼</button>
          {!left && (
            <BottomSheet title="기준일" open onClose={() => {}}>
              <button type="button" onClick={() => setLeft(true)}>
                떠나기
              </button>
            </BottomSheet>
          )}
        </>
      )
    }
    const { rerender } = render(<button type="button">밖의 버튼</button>)
    await user.click(screen.getByText('밖의 버튼'))
    rerender(<Leaving />)
    await user.click(screen.getByRole('button', { name: '떠나기' }))
    expect(document.querySelector('dialog')).toBeNull()
  })
})

describe('닫히는 움직임', () => {
  /** 움직임이 끝나기를 기다리는 동안을 만든다. */
  function holdAnimation() {
    const finished = Promise.withResolvers<void>()
    vi.spyOn(Element.prototype, 'getAnimations').mockReturnValue([{ finished: finished.promise } as unknown as Animation])
    return async () => {
      await act(async () => finished.resolve())
    }
  }

  it('내려가는 동안 남아 있다가 끝나면 사라진다', async () => {
    const user = await openSheet()
    const finish = holdAnimation()
    await user.keyboard('{Escape}')
    expect(screen.getByText('시트의 내용')).toBeTruthy()
    await finish()
    expect(document.querySelector('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener())
  })

  it('내려가는 동안 가림막이 걷히고 시트를 누를 수 없다', async () => {
    const user = await openSheet()
    expect(getComputedStyle(dialog()!).backgroundColor).toBe('var(--color-scrim)')
    const sheet = screen.getByText('시트의 내용').closest('dialog')!.firstElementChild!
    const finish = holdAnimation()
    await user.keyboard('{Escape}')
    expect(getComputedStyle(dialog()!).backgroundColor).not.toBe('var(--color-scrim)')
    expect(getComputedStyle(sheet).pointerEvents).toBe('none')
    expect(getComputedStyle(sheet).translate).toBe('0 100%')
    await finish()
  })

  it('움직임이 끊겨도 사라진다', async () => {
    const user = await openSheet()
    vi.spyOn(Element.prototype, 'getAnimations').mockImplementation(() => [
      { finished: Promise.reject(new DOMException('끊김', 'AbortError')) } as unknown as Animation,
    ])
    await user.keyboard('{Escape}')
    await act(async () => {})
    expect(document.querySelector('dialog')).toBeNull()
  })

  it('내려가는 동안 다시 열면 열린 채로 남는다', async () => {
    const finish = holdAnimation()
    const { rerender } = render(
      <BottomSheet title="기준일" open onClose={() => {}}>
        내용
      </BottomSheet>,
    )
    rerender(
      <BottomSheet title="기준일" open={false} onClose={() => {}}>
        내용
      </BottomSheet>,
    )
    rerender(
      <BottomSheet title="기준일" open onClose={() => {}}>
        내용
      </BottomSheet>,
    )
    await finish()
    expect(dialog()?.open).toBe(true)
  })
})

describe('아래로 끌기', () => {
  const HEIGHT = 400
  const head = () => screen.getByRole('heading', { name: '기준일' }).closest('[class*="head"]')!
  const sheet = () => dialog()!.firstElementChild as HTMLElement
  const dragged = () => sheet().style.getPropertyValue('--drag')

  async function openTallSheet() {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(HEIGHT)
    await openSheet()
  }

  function drag(from: Element, distance: number, init: PointerEventInit = {}) {
    const pointer = { pointerId: 1, isPrimary: true, button: 0, ...init }
    fireEvent.pointerDown(from, { ...pointer, clientY: 100 })
    fireEvent.pointerMove(from, { ...pointer, clientY: 100 + distance })
  }
  const release = (from: Element, distance: number) =>
    act(async () => {
      fireEvent.pointerUp(from, { pointerId: 1, isPrimary: true, button: 0, clientY: 100 + distance })
    })

  it('손가락을 따라 내려온다. 위로는 올라가지 않는다', async () => {
    await openTallSheet()
    drag(head(), 60)
    expect(dragged()).toBe('60px')
    fireEvent.pointerMove(head(), { pointerId: 1, isPrimary: true, clientY: 40 })
    expect(dragged()).toBe('0px')
  })

  it('시트 높이의 4분의 1보다 많이 끌고 놓으면 닫힌다', async () => {
    await openTallSheet()
    drag(head(), HEIGHT / 4 + 1)
    await release(head(), HEIGHT / 4 + 1)
    expect(document.querySelector('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener())
  })

  it('덜 끌고 놓으면 제자리로 돌아온다', async () => {
    await openTallSheet()
    drag(head(), HEIGHT / 4)
    await release(head(), HEIGHT / 4)
    expect(dialog()?.open).toBe(true)
    expect(dragged()).toBe('0px')
    // 놓은 뒤의 움직임은 끌기가 아니다
    fireEvent.pointerMove(head(), { pointerId: 1, isPrimary: true, clientY: 400 })
    expect(dragged()).toBe('0px')
  })

  it('끄는 동안은 움직임을 끄고, 놓으면 되살린다', async () => {
    await openTallSheet()
    drag(head(), 60)
    expect(sheet().hasAttribute('data-dragging')).toBe(true)
    await release(head(), 60)
    expect(sheet().hasAttribute('data-dragging')).toBe(false)
    expect(rule('.sheet[data-dragging]')).toContain('transition: none')
  })

  it('끌다가 끊기면 제자리로 돌아온다', async () => {
    await openTallSheet()
    drag(head(), 300)
    fireEvent.pointerCancel(head(), { pointerId: 1, isPrimary: true })
    expect(dialog()?.open).toBe(true)
    expect(dragged()).toBe('0px')
    expect(sheet().hasAttribute('data-dragging')).toBe(false)
  })

  it('손가락이 머리 밖으로 나가도 이어지게 포인터를 붙든다', async () => {
    const capture = vi.spyOn(Element.prototype, 'setPointerCapture')
    await openTallSheet()
    drag(head(), 10)
    expect(capture.mock.contexts).toEqual([head()])
    expect(capture.mock.calls).toEqual([[1]])
  })

  it('내용에서는 끌기를 받지 않는다', async () => {
    await openTallSheet()
    drag(screen.getByText('시트의 내용'), 300)
    expect(dragged()).toBe('')
    await release(screen.getByText('시트의 내용'), 300)
    expect(dialog()?.open).toBe(true)
  })

  it('끄는 동안 닿은 두 번째 손가락은 보지 않는다', async () => {
    await openTallSheet()
    drag(head(), 60)
    const second = { pointerId: 2, isPrimary: false, clientY: 400 }
    fireEvent.pointerMove(head(), second)
    fireEvent.pointerUp(head(), second)
    expect(dragged()).toBe('60px')
    expect(sheet().hasAttribute('data-dragging')).toBe(true)
  })

  it.each([
    ['두 번째 손가락', { isPrimary: false }],
    ['마우스 오른쪽 버튼', { button: 2 }],
  ])('%s으로는 끌지 않는다', async (_, init) => {
    await openTallSheet()
    drag(head(), 300, init)
    expect(dragged()).toBe('')
  })

  it('닫기 버튼에서 시작한 끌기는 받지 않는다', async () => {
    await openTallSheet()
    drag(screen.getByRole('button', { name: '닫기' }), 300)
    expect(dragged()).toBe('')
  })

  it('머리에서는 브라우저의 스크롤과 글자 선택이 시작되지 않는다', () => {
    expect(rule('.head')).toContain('touch-action: none')
    expect(rule('.head')).toContain('user-select: none')
  })
})

describe('모양', () => {
  it('고대비 모드에서도 경계가 보이게 투명한 테두리를 둔다', () => {
    expect(rule('.sheet')).toContain('outline: 1px solid transparent')
  })

  it('아래에 붙은 면이고 위쪽 두 모서리만 12px이며 높이는 화면의 90%까지다', async () => {
    await openSheet()
    const style = getComputedStyle(dialog()!.firstElementChild!)
    expect(style.position).toBe('absolute')
    expect(style.bottom).toBe('0px')
    expect(style.maxHeight).toBe('90%')
    expect(style.backgroundColor).toBe('var(--color-surface)')
    expect(style.borderRadius).toBe('var(--radius-12) var(--radius-12) 0 0')
    expect(style.boxShadow).toBe('var(--shadow-sheet)')
  })

  it('맨 위 가운데에 36x4px 손잡이, 머리의 왼쪽에 제목, 오른쪽에 닫기가 있다', async () => {
    await openSheet()
    const handle = getComputedStyle(dialog()!.querySelector('[class*="handle"]')!)
    expect(handle.width).toBe('var(--size-sheet-handle)')
    expect(handle.height).toBe('var(--space-4)')
    expect(handle.borderRadius).toBe('var(--radius-full)')
    expect(handle.backgroundColor).toBe('var(--color-border-strong)')
    expect(dialog()!.querySelector('[class*="handle"]')!.getAttribute('aria-hidden')).toBe('true')
    const title = screen.getByRole('heading', { name: '기준일' })
    expect(getComputedStyle(title).font).toBe('var(--text-title)')
    expect(title.compareDocumentPosition(screen.getByRole('button', { name: '닫기' }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('제목은 16px 선에서 시작하고 닫기 버튼은 오른쪽 4px에 있다', () => {
    expect(rule('.titleRow')).toContain('padding: var(--space-4) var(--space-4) 0 var(--space-16)')
  })

  it('내용이 넘치면 시트 안에서 스크롤하고 아래 안전 영역을 띄운다', async () => {
    await openSheet()
    const content = getComputedStyle(screen.getByText('시트의 내용').parentElement!)
    expect(content.overflowY).toBe('auto')
    expect(content.overscrollBehavior).toBe('contain')
    expect(rule('.content')).toContain('env(safe-area-inset-bottom)')
  })

  it('가림막이 화면을 덮고 뒤 화면은 스크롤되지 않는다', async () => {
    await openSheet()
    expect(overlayRule('.overlay')).toContain('inset: 0')
    expect(overlayRule('.scrim')).toContain('background-color: var(--color-scrim)')
    expect(overlayRule(':root:has(.overlay[open])')).toContain('overflow: hidden')
  })

  it('스크롤 막대가 자리를 차지하던 화면이면 그 자리를 남긴다', async () => {
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(window.innerWidth - 15)
    const user = await openSheet()
    expect(dialog()!.hasAttribute('data-scrollbar')).toBe(true)
    expect(overlayRule(':root:has(.overlay[data-scrollbar])')).toContain('scrollbar-gutter: stable')
    await user.keyboard('{Escape}')
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(window.innerWidth)
    await user.click(opener())
    expect(dialog()!.hasAttribute('data-scrollbar')).toBe(false)
  })

  it('아래에서 200ms 동안 올라오고 같은 값으로 내려간다', async () => {
    await openSheet()
    expect(rule('.sheet')).toContain('animation: rise var(--motion-sheet-duration) var(--motion-sheet-easing)')
    expect(rule('.sheet')).toContain('transition: translate var(--motion-sheet-duration) var(--motion-sheet-easing)')
    expect(rule('from')).toContain('translate: 0 100%')
  })
})
