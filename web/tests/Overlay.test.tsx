import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BottomSheet from '../src/components/BottomSheet'
import FieldPanel from '../src/components/FieldPanel'
import { readCssRule } from './support/cssRule'

/** 이어서 누른 것을 받지 않는 시간(ms) */
const GUARD = 300
/** 여는 것과 닫는 것이 화면에 그려지기까지의 한 화면(ms) */
const FRAME = 17

const shieldRule = () => readCssRule('src/components/pressGuard.module.css', '.shield')

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  // 화면에서 빠진 뒤에 남은 덮개를 걷는다
  vi.runAllTimers()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const pass = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))

const dialog = () => document.querySelector('dialog')
const shield = () => document.querySelector('[class*="shield"]')
const opener = () => screen.getByTestId('칸')
const content = () => screen.getByText('내용')

/** 브라우저가 누르기를 알리는 순서대로 보낸다. */
function press(target: Element) {
  fireEvent.pointerDown(target)
  fireEvent.mouseDown(target)
  fireEvent.pointerUp(target)
  fireEvent.mouseUp(target)
  fireEvent.click(target, { detail: 1 })
}

describe.each(['바닥 시트', '펼친 판'])('%s', (kind) => {
  function Sample() {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null)
    const [open, setOpen] = useState(false)
    const close = () => setOpen(false)
    return (
      <>
        <button
          type="button"
          data-testid="칸"
          onClick={(event) => {
            setAnchor(event.currentTarget)
            setOpen(true)
          }}
        >
          칸
        </button>
        {kind === '바닥 시트' && (
          <BottomSheet title="기준일" open={open} onClose={close}>
            <button type="button" onClick={close}>
              내용
            </button>
          </BottomSheet>
        )}
        {kind === '펼친 판' && anchor && (
          <FieldPanel label="기준일" open={open} anchor={anchor} onClose={close}>
            <button type="button" onClick={close}>
              내용
            </button>
          </FieldPanel>
        )}
      </>
    )
  }

  async function open() {
    act(() => opener().focus())
    await act(async () => fireEvent.click(opener()))
  }

  async function start() {
    const view = render(<Sample />)
    await open()
    return view
  }

  /** 다 열린 뒤 안의 것을 눌러 닫는다. */
  async function startAndClose() {
    const view = await start()
    await pass(GUARD + FRAME)
    await act(async () => press(content()))
    return view
  }

  describe('막 연 동안', () => {
    it('바깥을 눌러도 닫히지 않고, 다 열리면 닫힌다', async () => {
      await start()
      await pass(GUARD - 1)
      await act(async () => press(dialog()!))
      expect(dialog()?.open).toBe(true)
      await pass(FRAME + 1)
      await act(async () => press(dialog()!))
      expect(dialog()).toBeNull()
    })

    it('두 번 그리는 개발 모드에서도 다 열리면 바깥을 눌러 닫는다', async () => {
      render(
        <StrictMode>
          <Sample />
        </StrictMode>,
      )
      await open()
      await act(async () => press(dialog()!))
      expect(dialog()?.open).toBe(true)
      await pass(GUARD + FRAME)
      await act(async () => press(dialog()!))
      expect(dialog()).toBeNull()
    })

    it('바깥을 누르기 시작해 다 열린 뒤에 떼어도 닫히지 않는다', async () => {
      await start()
      fireEvent.pointerDown(dialog()!)
      fireEvent.mouseDown(dialog()!)
      await pass(GUARD + FRAME)
      fireEvent.pointerUp(dialog()!)
      await act(async () => fireEvent.click(dialog()!, { detail: 1 }))
      expect(dialog()?.open).toBe(true)
    })

    it('안의 것을 누를 수 없고, 다 열리면 누를 수 있다', async () => {
      await start()
      expect(getComputedStyle(content()).pointerEvents).toBe('none')
      await pass(GUARD + FRAME)
      expect(getComputedStyle(content()).pointerEvents).not.toBe('none')
    })

    it('손가락으로 누르기 시작한 것은 다 열린 뒤에 떼어도 누른 것이 되지 않는다', async () => {
      await start()
      // 안의 것을 누를 수 없으므로 브라우저는 층을 눌렀다고 알린다. 막으면 이어지는 누르기가 오지 않는다
      expect(fireEvent.touchStart(dialog()!)).toBe(false)
      await pass(GUARD + FRAME)
      expect(fireEvent.touchStart(dialog()!)).toBe(true)
    })

    it('눌러도 초점이 안에 남는다', async () => {
      await start()
      expect(fireEvent.mouseDown(dialog()!)).toBe(false)
      await pass(GUARD + FRAME)
      expect(fireEvent.mouseDown(dialog()!)).toBe(true)
    })

    it('화면에서 빠져도 남는 시계가 없다', async () => {
      const { unmount } = await start()
      await pass(FRAME)
      unmount()
      await pass(GUARD + FRAME)
      expect(vi.getTimerCount()).toBe(0)
    })

    it('Esc는 바로 받는다', async () => {
      await start()
      await act(async () => fireEvent.keyDown(document.activeElement!, { key: 'Escape' }))
      expect(dialog()).toBeNull()
    })

    it('키보드로 누른 것은 바로 받는다', async () => {
      await start()
      await act(async () => fireEvent.click(content(), { detail: 0 }))
      expect(dialog()).toBeNull()
    })
  })

  describe('닫은 뒤', () => {
    it('초점은 바로 돌아가고, 300ms 동안 뒤 화면을 덮었다가 푼다', async () => {
      await startAndClose()
      expect(dialog()).toBeNull()
      expect(document.activeElement).toBe(opener())
      expect(shield()).toBeTruthy()
      await pass(GUARD - 1)
      expect(shield()).toBeTruthy()
      await pass(FRAME + 1)
      expect(shield()).toBeNull()
    })

    it('덮은 것을 눌러도 초점이 칸에 남고, 손가락으로 누르기 시작한 것은 누른 것이 되지 않는다', async () => {
      await startAndClose()
      expect(fireEvent.mouseDown(shield()!)).toBe(false)
      expect(fireEvent.touchStart(shield()!)).toBe(false)
    })

    it('덮은 동안에도 키보드로 다시 열 수 있다', async () => {
      await startAndClose()
      await open()
      expect(dialog()?.open).toBe(true)
      expect(shield()).toBeNull()
    })

    it('다시 열었다 닫으면 그때부터 다시 덮는다', async () => {
      await startAndClose()
      await pass(GUARD / 2)
      await open()
      await act(async () => fireEvent.keyDown(document.activeElement!, { key: 'Escape' }))
      await pass(GUARD - 1)
      expect(shield()).toBeTruthy()
      await pass(FRAME + 1)
      expect(shield()).toBeNull()
    })

    it('덮은 동안 화면에서 빠져도 시간이 다 될 때까지 덮고, 남는 것이 없다', async () => {
      const { unmount } = await startAndClose()
      await pass(GUARD - 1)
      unmount()
      expect(shield()).toBeTruthy()
      await pass(FRAME + 1)
      expect(shield()).toBeNull()
      expect(vi.getTimerCount()).toBe(0)
    })

    it('연 채로 화면에서 빠지면 그때부터 덮는다. 안의 버튼이 다른 화면으로 보낸 때다', async () => {
      const { unmount } = await start()
      await pass(GUARD + FRAME)
      unmount()
      expect(dialog()).toBeNull()
      expect(fireEvent.mouseDown(shield()!)).toBe(false)
      expect(fireEvent.touchStart(shield()!)).toBe(false)
      await pass(GUARD - 1)
      expect(shield()).toBeTruthy()
      await pass(FRAME + 1)
      expect(shield()).toBeNull()
    })

    it('두 번 그리는 개발 모드에서도 열려 있는 동안에는 덮지 않는다', async () => {
      render(
        <StrictMode>
          <Sample />
        </StrictMode>,
      )
      await open()
      expect(dialog()?.open).toBe(true)
      expect(shield()).toBeNull()
    })

    it('덮은 것은 화면의 어느 요소 안에도 있지 않다. 움직이는 조상이 있으면 화면을 다 덮지 못한다', async () => {
      await startAndClose()
      expect(shield()!.parentElement).toBe(document.body)
    })

    it('연 적이 없으면 덮지 않는다', async () => {
      render(<Sample />)
      expect(shield()).toBeNull()
    })

    it('닫히는 움직임이 더 길면 끝날 때까지 남아 있고 그 뒤에는 덮지 않는다', async () => {
      const motion = Promise.withResolvers<void>()
      vi.spyOn(Element.prototype, 'getAnimations').mockReturnValue([{ finished: motion.promise } as unknown as Animation])
      await startAndClose()
      await pass(GUARD + FRAME)
      expect(dialog()?.open).toBe(true)
      await act(async () => motion.resolve())
      expect(dialog()).toBeNull()
      expect(shield()).toBeNull()
      expect(document.activeElement).toBe(opener())
    })

    it('닫히는 동안 안의 것과 바깥을 누를 수 없다', async () => {
      const motion = Promise.withResolvers<void>()
      vi.spyOn(Element.prototype, 'getAnimations').mockReturnValue([{ finished: motion.promise } as unknown as Animation])
      await startAndClose()
      expect(getComputedStyle(content()).pointerEvents).toBe('none')
      expect(fireEvent.touchStart(dialog()!)).toBe(false)
      expect(fireEvent.mouseDown(dialog()!)).toBe(false)
      await act(async () => motion.resolve())
    })
  })
})

describe('바닥 시트의 X', () => {
  const closeButton = () => screen.getByRole('button', { name: '닫기' })

  function start() {
    const onClose = vi.fn()
    render(
      <BottomSheet title="기준일" open onClose={onClose}>
        내용
      </BottomSheet>,
    )
    return onClose
  }

  it('막 연 동안은 누를 수 없고 그 뒤에는 누를 수 있다', async () => {
    start()
    expect(getComputedStyle(closeButton()).pointerEvents).toBe('none')
    await pass(GUARD + FRAME)
    expect(getComputedStyle(closeButton()).pointerEvents).not.toBe('none')
  })

  it('키보드로 누른 것은 바로 받는다', () => {
    const onClose = start()
    fireEvent.click(closeButton(), { detail: 0 })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('브라우저가 강제로 닫으면', () => {
  // 사용자 동작 없이 Esc를 두 번 누르면 브라우저가 cancel을 막지 못하게 하고 닫는다
  const forceClose = () => act(async () => dialog()!.close())

  it('부르는 쪽이 그대로 열어 두면 다시 연다', async () => {
    const onClose = vi.fn()
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal')
    render(
      <BottomSheet title="기준일" open onClose={onClose}>
        내용
      </BottomSheet>,
    )
    await forceClose()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(dialog()?.open).toBe(true)
    await forceClose()
    expect(dialog()?.open).toBe(true)
    expect(showModal).toHaveBeenCalledTimes(3)
  })

  it('부르는 쪽이 늦게 닫아도 닫힌다', async () => {
    function Late() {
      const [open, setOpen] = useState(true)
      return (
        <BottomSheet title="기준일" open={open} onClose={() => setTimeout(() => setOpen(false), 50)}>
          내용
        </BottomSheet>
      )
    }
    render(<Late />)
    await forceClose()
    expect(dialog()?.open).toBe(true)
    await pass(50)
    expect(dialog()).toBeNull()
  })

  it('두 번 그리는 개발 모드에서는 여는 것을 강제로 닫은 것으로 보지 않는다', async () => {
    const onClose = vi.fn()
    render(
      <StrictMode>
        <BottomSheet title="기준일" open onClose={onClose}>
          내용
        </BottomSheet>
      </StrictMode>,
    )
    await pass(FRAME)
    expect(onClose).not.toHaveBeenCalled()
    expect(dialog()?.open).toBe(true)
  })
})

it('덮는 것은 화면 전체이고 상단 바와 하단 탭보다 위다', () => {
  expect(shieldRule()).toContain('position: fixed')
  expect(shieldRule()).toContain('inset: 0')
  const zIndexOf = (rule: string) => Number(/z-index: (\d+)/.exec(rule)?.[1])
  const bars = [
    readCssRule('src/components/Screen.module.css', '.topBar'),
    readCssRule('src/app/TabBar.module.css', '.tabBar'),
  ]
  for (const bar of bars) expect(zIndexOf(shieldRule())).toBeGreaterThan(zIndexOf(bar))
})
