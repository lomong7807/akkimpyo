import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ConfirmDialog from '../src/components/ConfirmDialog'
import { readCssRule } from './support/cssRule'
import { untilOpened } from './support/dialog'
import { installMatchMedia } from './support/viewport'

const CSS = 'src/components/ConfirmDialog.module.css'
const CENTER_CSS = 'src/components/CenterDialog.module.css'

let viewport: ReturnType<typeof installMatchMedia>

beforeEach(() => {
  viewport = installMatchMedia(390)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const onAction = vi.fn()
afterEach(() => onAction.mockClear())

function Sample() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        묻기
      </button>
      <ConfirmDialog
        open={open}
        title="쓰던 내용을 버릴까요?"
        description="저장하지 않은 내용은 사라져요."
        closeLabel="계속 쓰기"
        actionLabel="버리기"
        onClose={() => setOpen(false)}
        onAction={onAction}
      />
    </>
  )
}

const opener = () => screen.getByText('묻기')
const dialog = () => screen.queryByRole<HTMLDialogElement>('dialog')
const keep = () => screen.getByRole('button', { name: '계속 쓰기' })
const discard = () => screen.getByRole('button', { name: '버리기' })
const styleOf = (element: Element) => getComputedStyle(element)

async function ask(width = 390) {
  viewport.resizeTo(width)
  const user = userEvent.setup()
  render(<Sample />)
  await user.click(opener())
  return user
}

const layouts = [
  ['휴대폰 배치', 390],
  ['넓은 화면', 1280],
] as const

describe.each(layouts)('확인 창: %s', (_, width) => {
  it('묻는 말이 이름인 모달이고 설명과 두 버튼이 있다', async () => {
    await ask(width)
    expect(screen.getByRole('dialog', { name: '쓰던 내용을 버릴까요?' })).toBe(dialog())
    expect(screen.getByRole('heading', { level: 2, name: '쓰던 내용을 버릴까요?' })).toBeTruthy()
    expect(screen.getByText('저장하지 않은 내용은 사라져요.')).toBeTruthy()
    expect(keep().compareDocumentPosition(discard())).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('첫 초점은 물러나는 버튼이다', async () => {
    await ask(width)
    expect(document.activeElement).toBe(keep())
  })

  it.each([
    ['물러나는 버튼', (user) => user.click(keep())],
    ['가림막', (user) => user.click(dialog()!)],
    ['Esc', (user) => user.keyboard('{Escape}')],
  ] as [string, (user: ReturnType<typeof userEvent.setup>) => Promise<unknown>][])(
    '%s로 닫으면 실행하지 않고 초점이 연 버튼으로 돌아간다',
    async (_, close) => {
      const user = await ask(width)
      await untilOpened()
      await close(user)
      await act(async () => {})
      expect(document.querySelector('dialog')).toBeNull()
      expect(document.activeElement).toBe(opener())
      expect(onAction).not.toHaveBeenCalled()
    },
  )

  it('실행 버튼을 누르면 한 번 알리고 닫는 것은 화면이 한다', async () => {
    const user = await ask(width)
    await untilOpened()
    await user.click(discard())
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(dialog()?.open).toBe(true)
  })

  it('두 버튼은 같은 폭으로 한 줄이고 높이가 48px이며, 들어가지 않으면 실행 버튼이 위로 쌓인다', async () => {
    await ask(width)
    const [keepSlot, discardSlot] = [keep().parentElement!, discard().parentElement!]
    const row = styleOf(keepSlot.parentElement!)
    expect(row.display).toBe('flex')
    expect(row.flexWrap).toBe('wrap-reverse')
    expect(row.gap).toBe('var(--space-8)')
    expect(row.marginTop).toBe('var(--space-24)')
    for (const slot of [keepSlot, discardSlot]) {
      expect(styleOf(slot).flex).toBe('1 1 calc(50% - var(--space-8) / 2)')
      expect(styleOf(slot).minHeight).toBe('var(--size-button)')
      expect(styleOf(slot).display).toBe('grid')
      // 글자보다 좁아지지 않아야 한 줄에 들어가지 않을 때 쌓인다
      expect(styleOf(slot).getPropertyValue('grid-template-columns')).toBe('minmax(max-content, 1fr)')
    }
  })

  it('왼쪽은 보조 버튼, 오른쪽은 위험 버튼이다', async () => {
    await ask(width)
    expect(styleOf(keep()).backgroundColor).toBe('var(--color-surface)')
    expect(styleOf(discard()).backgroundColor).toBe('var(--color-danger)')
  })

  it('설명은 본문 크기의 보조 글자색이다', async () => {
    await ask(width)
    const description = styleOf(screen.getByText('저장하지 않은 내용은 사라져요.'))
    expect(description.font).toBe('var(--text-body)')
    expect(description.color).toBe('var(--color-text-secondary)')
    expect(description.margin).toBe('0px')
  })
})

describe('휴대폰 배치의 확인 창', () => {
  it('바닥 시트다. X로 닫아도 물러나는 것과 같다', async () => {
    const user = await ask()
    await untilOpened()
    expect(dialog()!.querySelector('[class*="handle"]')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '닫기' }))
    expect(document.querySelector('dialog')).toBeNull()
    expect(onAction).not.toHaveBeenCalled()
  })

  it('좌우 16px이고 버튼 아래는 시트의 8px에 4px을 더한 12px과 안전 영역이다', async () => {
    await ask()
    const body = screen.getByText('저장하지 않은 내용은 사라져요.').parentElement!
    expect(styleOf(body).getPropertyValue('padding-inline')).toBe('var(--space-16)')
    expect(styleOf(body).paddingBottom).toBe('var(--space-4)')
    expect(readCssRule('src/components/BottomSheet.module.css', '.content')).toContain(
      'calc(var(--space-8) + env(safe-area-inset-bottom))',
    )
  })
})

describe('넓은 화면의 확인 창', () => {
  it('폭 480px의 가운데 창이고 가림막이 있으며 X와 손잡이가 없다', async () => {
    await ask(1280)
    const window = dialog()!.firstElementChild!
    const style = styleOf(window)
    expect(style.position).toBe('absolute')
    expect(style.inset).toBe('0px')
    expect(style.margin).toBe('auto')
    expect(style.height).toBe('fit-content')
    expect(readCssRule(CENTER_CSS, '.window')).toContain(
      'width: min(var(--width-dialog), 100% - 2 * var(--space-24))',
    )
    expect(readCssRule(CENTER_CSS, '.window')).toContain(' padding: var(--space-24)')
    expect(style.borderRadius).toBe('var(--radius-12)')
    expect(style.backgroundColor).toBe('var(--color-surface)')
    expect(style.boxShadow).toBe('var(--shadow-dialog)')
    expect(styleOf(dialog()!).backgroundColor).toBe('var(--color-scrim)')
    expect(within(dialog()!).getAllByRole('button')).toEqual([keep(), discard()])
    expect(dialog()!.querySelector('[class*="handle"]')).toBeNull()
  })

  it('제목은 제목 크기이고 설명과 8px 떨어진다', async () => {
    await ask(1280)
    const title = styleOf(screen.getByRole('heading', { level: 2 }))
    expect(title.font).toBe('var(--text-title)')
    expect(title.marginBottom).toBe('var(--space-8)')
  })

  it('낮은 화면에서는 창 안에서 스크롤한다', async () => {
    await ask(1280)
    expect(readCssRule(CENTER_CSS, '.window')).toContain('max-height: calc(100% - 2 * var(--space-24))')
    expect(styleOf(dialog()!.firstElementChild!).overflowY).toBe('auto')
  })

  it('200ms 투명도로 나타나고 사라진다. 자리와 크기는 움직이지 않는다', () => {
    const rule = readCssRule(CENTER_CSS, '.window')
    expect(rule).toContain('animation: appear var(--motion-sheet-duration) var(--motion-sheet-easing)')
    expect(rule).toContain('transition: opacity var(--motion-sheet-duration) var(--motion-sheet-easing)')
    expect(readCssRule(CENTER_CSS, 'from')).toContain('opacity: 0')
    expect(readCssRule(CENTER_CSS, 'dialog[data-closing] > .window')).toContain('opacity: 0')
    expect(rule).not.toMatch(/translate|transform|scale/)
  })

  it('고대비 모드에서도 경계가 보이게 투명한 테두리를 둔다', () => {
    expect(readCssRule(CENTER_CSS, '.window')).toContain('outline: 1px solid transparent')
  })

  it('시트의 여백은 걸리지 않는다', async () => {
    await ask(1280)
    const body = screen.getByText('저장하지 않은 내용은 사라져요.').parentElement!
    expect(styleOf(body).getPropertyValue('padding-inline')).not.toBe('var(--space-16)')
    expect(readCssRule(CSS, '.actions')).not.toContain('border')
  })
})

describe('열린 채로', () => {
  it('화면 폭이 바뀌어도 그대로 묻고 첫 초점을 다시 준다', async () => {
    await ask(390)
    await act(async () => viewport.resizeTo(1280))
    expect(dialog()?.open).toBe(true)
    expect(screen.queryByRole('button', { name: '닫기' })).toBeNull()
    expect(document.activeElement).toBe(keep())
    await act(async () => viewport.resizeTo(390))
    expect(screen.getByRole('button', { name: '닫기' })).toBeTruthy()
    expect(document.activeElement).toBe(keep())
  })

  it.each(layouts)('닫히는 중에 다시 열리면 내용이 새로 시작한다: %s', async (_, width) => {
    viewport.resizeTo(width)
    const motion = Promise.withResolvers<void>()
    vi.spyOn(Element.prototype, 'getAnimations').mockReturnValue([{ finished: motion.promise } as unknown as Animation])
    const ask = (open: boolean) => (
      <ConfirmDialog
        open={open}
        title="쓰던 내용을 버릴까요?"
        description="저장하지 않은 내용은 사라져요."
        closeLabel="계속 쓰기"
        actionLabel="버리기"
        onClose={() => {}}
        onAction={onAction}
      />
    )
    const { rerender } = render(ask(true))
    const first = keep()
    act(() => discard().focus())
    rerender(ask(false))
    expect(dialog()?.open).toBe(true)
    rerender(ask(true))
    expect(keep()).not.toBe(first)
    expect(document.activeElement).toBe(keep())
    await act(async () => motion.resolve())
    expect(dialog()?.open).toBe(true)
  })
})
