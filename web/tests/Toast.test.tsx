import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ToastProvider from '../src/app/ToastProvider'
import { useToast } from '../src/components/ToastContext'
import { readCssRule } from './support/cssRule'
import { resetViewport, setViewportWidth } from './support/viewport'
import { readWebFile } from './support/webFile'

const CSS = 'src/app/ToastProvider.module.css'
const LAYOUT_CSS = 'src/app/AppLayout.module.css'
const DURATION = 4000

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
})

afterEach(() => {
  cleanup()
  resetViewport()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function Caller() {
  const showToast = useToast()
  return (
    <>
      <button type="button" onClick={() => showToast("'신한카드' 계좌를 추가했어요.")}>
        알리기
      </button>
      <button type="button" onClick={() => showToast('다른 알림')}>
        또 알리기
      </button>
    </>
  )
}

function renderToasts() {
  return render(
    <ToastProvider>
      <Caller />
    </ToastProvider>,
  )
}

const press = (name: string) => fireEvent.click(screen.getByText(name))
const pass = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))
const region = () => screen.getByRole('status')
const toast = () => region().firstElementChild as HTMLElement | null
const message = () => region().textContent

describe('토스트의 자리', () => {
  it('알림 영역은 비어 있어도 늘 있다', () => {
    renderToasts()
    expect(region().textContent).toBe('')
    expect(toast()).toBeNull()
  })

  it('부르면 같은 영역에 문구를 보인다', () => {
    renderToasts()
    const before = region()
    press('알리기')
    expect(region()).toBe(before)
    expect(message()).toBe("'신한카드' 계좌를 추가했어요.")
  })

  it('영역은 뒤 화면을 누르는 것을 막지 않고 토스트만 누른다', () => {
    renderToasts()
    press('알리기')
    expect(getComputedStyle(region()).pointerEvents).toBe('none')
    expect(getComputedStyle(toast()!).pointerEvents).toBe('auto')
  })

  it('상단 바와 하단 탭, 덮개보다 위다', () => {
    const zIndexOf = (path: string, selector: string) => Number(/z-index: (\d+)/.exec(readCssRule(path, selector))?.[1])
    const own = zIndexOf(CSS, '.region')
    expect(own).toBeGreaterThan(zIndexOf('src/components/pressGuard.module.css', '.shield'))
    expect(own).toBeGreaterThan(zIndexOf('src/app/TabBar.module.css', '.tabBar'))
  })

  it('휴대폰 배치는 하단 탭이나 아래 안전 영역의 16px 위이고 좌우 16px을 뺀 폭이다', () => {
    expect(readCssRule(CSS, '.region')).toContain(
      'bottom: calc(var(--toast-offset, env(safe-area-inset-bottom)) + var(--space-16))',
    )
    expect(readCssRule(CSS, '.region')).toContain(
      'padding-inline: max(var(--space-16), env(safe-area-inset-left)) max(var(--space-16), env(safe-area-inset-right))',
    )
    expect(readCssRule(LAYOUT_CSS, ':root:has(.withTabs)')).toContain(
      '--toast-offset: calc(var(--size-tabbar) + env(safe-area-inset-bottom))',
    )
  })

  it.each([
    [390, '100%', 'var(--width-content-narrow)'],
    [768, '100%', 'var(--width-content-narrow)'],
    [1280, '100%', 'var(--width-toast)'],
  ])('폭 %dpx에서 폭은 %s이고 최대 %s다', (width, own, max) => {
    renderToasts()
    press('알리기')
    setViewportWidth(width)
    expect(getComputedStyle(toast()!).width).toBe(own)
    expect(getComputedStyle(toast()!).maxWidth).toBe(max)
    expect(getComputedStyle(region()).justifyContent).toBe('center')
  })

  it('넓은 화면은 사이드바 옆 내용 영역의 가운데이고 아래에서 24px이다', () => {
    renderToasts()
    setViewportWidth(1280)
    expect(getComputedStyle(region()).bottom).toBe('calc(var(--space-24) + env(safe-area-inset-bottom))')
    expect(readCssRule(CSS, '.region')).toContain('inset-inline: var(--toast-start, 0) 0')
    expect(readWebFile(LAYOUT_CSS)).toContain('--toast-start: var(--width-sidebar)')
  })
})

describe('토스트의 모양', () => {
  it('높이 56px 이상, 모서리 12px, 반전 색, 본문 글자이고 그림자가 없다', () => {
    renderToasts()
    press('알리기')
    const style = getComputedStyle(toast()!)
    expect(style.minHeight).toBe('var(--size-toast)')
    expect(style.borderRadius).toBe('var(--radius-12)')
    expect(style.backgroundColor).toBe('var(--color-inverse)')
    expect(style.color).toBe('var(--color-on-inverse)')
    expect(style.font).toBe('var(--text-body)')
    expect(style.boxShadow).toBe('')
  })

  it('긴 글은 두 줄까지 늘어나고 그 뒤는 줄임표다. 띄어쓰기가 없어도 칸 안에서 줄을 바꾼다', () => {
    const rule = readCssRule(CSS, '.message')
    expect(rule).toContain('-webkit-line-clamp: 2')
    expect(rule).toContain('overflow: hidden')
    expect(rule).toContain('overflow-wrap: anywhere')
  })

  it('글자로만 그린다', () => {
    function Html() {
      const showToast = useToast()
      return (
        <button type="button" onClick={() => showToast('<b>굵게</b>')}>
          누르기
        </button>
      )
    }
    render(
      <ToastProvider>
        <Html />
      </ToastProvider>,
    )
    press('누르기')
    expect(message()).toBe('<b>굵게</b>')
    expect(region().querySelector('b')).toBeNull()
  })

  it('150ms 투명도로만 나타나고 사라진다', () => {
    const rule = readCssRule(CSS, '.toast')
    expect(rule).toContain('animation: appear var(--motion-toast-duration)')
    expect(rule).toContain('transition: opacity var(--motion-toast-duration)')
    expect(readCssRule(CSS, '.toast[data-closing]')).toContain('opacity: 0')
    expect(rule).not.toMatch(/translate|transform/)
  })
})

describe('지속 시간', () => {
  it('4초 뒤에 사라진다', async () => {
    renderToasts()
    press('알리기')
    await pass(DURATION - 1)
    expect(message()).not.toBe('')
    await pass(1)
    expect(message()).toBe('')
  })

  it('두 번 그리는 개발 모드에서도 4초다', async () => {
    render(
      <StrictMode>
        <ToastProvider>
          <Caller />
        </ToastProvider>
      </StrictMode>,
    )
    press('알리기')
    await pass(DURATION - 1)
    expect(message()).not.toBe('')
    await pass(1)
    expect(message()).toBe('')
  })

  it('마우스가 올라가 있는 동안 시간이 멈추고, 내리면 남은 시간만큼 더 보인다', async () => {
    renderToasts()
    press('알리기')
    await pass(3000)
    fireEvent.pointerEnter(toast()!)
    await pass(10_000)
    expect(message()).not.toBe('')
    fireEvent.pointerLeave(toast()!)
    await pass(999)
    expect(message()).not.toBe('')
    await pass(1)
    expect(message()).toBe('')
  })

  it('초점이 안에 있는 동안 시간이 멈춘다', async () => {
    renderToasts()
    press('알리기')
    fireEvent.focus(toast()!)
    await pass(10_000)
    expect(message()).not.toBe('')
    fireEvent.blur(toast()!)
    await pass(DURATION)
    expect(message()).toBe('')
  })

  it('초점이 있으면 마우스를 내려도 멈춰 있다', async () => {
    renderToasts()
    press('알리기')
    fireEvent.pointerEnter(toast()!)
    fireEvent.focus(toast()!)
    fireEvent.pointerLeave(toast()!)
    await pass(10_000)
    expect(message()).not.toBe('')
  })

  it('사라지는 움직임이 끝난 뒤에 빠진다', async () => {
    const motion = Promise.withResolvers<void>()
    vi.spyOn(Element.prototype, 'getAnimations').mockReturnValue([{ finished: motion.promise } as unknown as Animation])
    renderToasts()
    press('알리기')
    expect(toast()!.hasAttribute('data-closing')).toBe(false)
    await pass(DURATION)
    expect(toast()!.hasAttribute('data-closing')).toBe(true)
    await act(async () => motion.resolve())
    expect(message()).toBe('')
  })

  it('화면에서 빠지면 남는 시계가 없다', () => {
    const { unmount } = renderToasts()
    press('알리기')
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('겹침', () => {
  it('새 토스트가 오면 앞의 것을 바로 바꾸고 4초를 새로 센다', async () => {
    renderToasts()
    press('알리기')
    await pass(3000)
    press('또 알리기')
    expect(message()).toBe('다른 알림')
    await pass(DURATION - 1)
    expect(message()).toBe('다른 알림')
    await pass(1)
    expect(message()).toBe('')
  })

  it('사라지는 중에 온 새 토스트를 앞의 것이 지우지 않는다', async () => {
    const motion = Promise.withResolvers<void>()
    vi.spyOn(Element.prototype, 'getAnimations').mockReturnValueOnce([
      { finished: motion.promise } as unknown as Animation,
    ])
    renderToasts()
    press('알리기')
    await pass(DURATION)
    press('또 알리기')
    await act(async () => motion.resolve())
    expect(message()).toBe('다른 알림')
    expect(toast()!.hasAttribute('data-closing')).toBe(false)
  })

  it('같은 문구를 또 알려도 새로 그려 다시 읽힌다', () => {
    renderToasts()
    press('알리기')
    const first = toast()
    press('알리기')
    expect(toast()).not.toBe(first)
  })
})

describe('아래로 밀어 닫기', () => {
  const HEIGHT = 56
  const pointer = { pointerId: 1, isPrimary: true, button: 0 }

  function start() {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(HEIGHT)
    renderToasts()
    press('알리기')
    fireEvent.pointerDown(toast()!, { ...pointer, clientY: 100 })
  }
  const move = (distance: number, init = {}) =>
    act(async () => void fireEvent.pointerMove(toast()!, { ...pointer, clientY: 100 + distance, ...init }))

  it('높이의 4분의 1보다 많이 밀면 닫힌다', async () => {
    start()
    await move(HEIGHT / 4)
    expect(message()).not.toBe('')
    await move(HEIGHT / 4 + 1)
    expect(message()).toBe('')
  })

  it('위로 밀면 닫히지 않는다', async () => {
    start()
    await move(-100)
    expect(message()).not.toBe('')
  })

  it('떼거나 끊긴 뒤의 움직임은 미는 것이 아니다', async () => {
    start()
    fireEvent.pointerUp(toast()!, pointer)
    await move(100)
    expect(message()).not.toBe('')
    fireEvent.pointerDown(toast()!, { ...pointer, clientY: 100 })
    fireEvent.pointerCancel(toast()!, pointer)
    await move(100)
    expect(message()).not.toBe('')
  })

  it('두 번째 손가락과 마우스 오른쪽 버튼으로는 밀지 않는다', async () => {
    start()
    fireEvent.pointerUp(toast()!, pointer)
    fireEvent.pointerDown(toast()!, { ...pointer, button: 2, clientY: 100 })
    await move(100)
    expect(message()).not.toBe('')
    fireEvent.pointerDown(toast()!, { ...pointer, isPrimary: false, clientY: 100 })
    await move(100)
    expect(message()).not.toBe('')
  })

  it('손가락이 밖으로 나가도 이어지게 포인터를 붙들고, 브라우저의 스크롤과 글자 선택이 시작되지 않는다', () => {
    const capture = vi.spyOn(Element.prototype, 'setPointerCapture')
    start()
    expect(capture.mock.calls).toEqual([[1]])
    expect(readCssRule(CSS, '.toast')).toContain('touch-action: none')
    expect(readCssRule(CSS, '.toast')).toContain('user-select: none')
  })
})

describe('모달이 열려 있으면', () => {
  function openDialog() {
    const dialog = document.createElement('dialog')
    document.body.append(dialog)
    dialog.showModal()
    return dialog
  }
  const settle = () => act(async () => void (await new Promise((resolve) => setImmediate(resolve))))

  afterEach(() => document.querySelectorAll('dialog').forEach((dialog) => dialog.remove()))

  it('닫힌 뒤에 알리고 그때부터 4초다', async () => {
    renderToasts()
    const dialog = openDialog()
    press('알리기')
    await pass(DURATION)
    expect(message()).toBe('')
    dialog.close()
    await settle()
    expect(message()).not.toBe('')
    await pass(DURATION - 1)
    expect(message()).not.toBe('')
    await pass(1)
    expect(message()).toBe('')
  })

  it('기다리는 동안 새로 온 것만 알린다', async () => {
    renderToasts()
    const dialog = openDialog()
    press('알리기')
    press('또 알리기')
    dialog.close()
    await settle()
    expect(message()).toBe('다른 알림')
  })

  it('기다리는 동안 공급자가 사라지면 알리지 않는다', async () => {
    const { unmount } = renderToasts()
    const dialog = openDialog()
    press('알리기')
    unmount()
    const consoleError = vi.spyOn(console, 'error')
    dialog.close()
    await settle()
    expect(document.body.textContent).toBe('')
    expect(consoleError).not.toHaveBeenCalled()
  })
})

it('공급자를 다시 만들면 앞의 알림이 남지 않는다', () => {
  function Keyed() {
    const [session, setSession] = useState(0)
    return (
      <>
        <button type="button" onClick={() => setSession(session + 1)}>
          로그아웃
        </button>
        <ToastProvider key={session}>
          <Caller />
        </ToastProvider>
      </>
    )
  }
  render(<Keyed />)
  press('알리기')
  press('로그아웃')
  expect(message()).toBe('')
})

it('공급자 밖에서는 쓸 수 없다', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(() => render(<Caller />)).toThrow()
})
