import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createBrowserRouter, Link, useNavigate, type RouteObject } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Button } from '../src/components/Button'
import FullScreenForm from '../src/components/FullScreenForm'
import { TextField } from '../src/components/TextField'
import { useLeaveGuard } from '../src/components/useLeaveGuard'
import { readCssRule } from './support/cssRule'
import { shield, untilOpened, untilUnshielded } from './support/dialog'
import { recordDom } from './support/recordDom'
import { installMatchMedia, resetViewport, setViewportWidth } from './support/viewport'
import { readWebFile } from './support/webFile'

const CSS = 'src/components/FullScreenForm.module.css'
const question = '쓰던 내용을 버릴까요?'

const onSubmit = vi.fn()

function Form() {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const guard = useLeaveGuard({ parent: '/list', changed: name !== '', busy })
  return (
    <FullScreenForm
      title="계좌 추가"
      guard={guard}
      onSubmit={onSubmit}
      bottom={
        <Button kind="primary" type="submit" busy={busy}>
          저장
        </Button>
      }
    >
      <TextField label="이름" value={name} onChange={(event) => setName(event.target.value)} />
      <Link to="/other">다른 화면</Link>
      <button type="button" onClick={() => guard.leave(() => navigate('/list', { replace: true }))}>
        저장을 마침
      </button>
      <button type="button" onClick={() => setBusy(!busy)}>
        처리 바꾸기
      </button>
    </FullScreenForm>
  )
}

const routes: RouteObject[] = [
  {
    path: '/list',
    element: (
      <>
        <p>목록</p>
        <Link to="/new">추가</Link>
      </>
    ),
  },
  { path: '/new', element: <Form /> },
  { path: '/other', element: <p>다른 내용</p> },
  { path: '/home', element: <Link to="/list">목록으로</Link> },
]

let router: ReturnType<typeof createBrowserRouter>

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn())
  installMatchMedia(390)
})

afterEach(() => {
  cleanup()
  router?.dispose()
  resetViewport()
  onSubmit.mockClear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// 닫기와 뒤로는 브라우저 방문 기록을 보므로 실제 history를 쓰는 라우터로 확인한다
function openAt(path: string) {
  window.history.replaceState(null, '', path)
  router = createBrowserRouter(routes)
  render(<RouterProvider router={router} />)
  return userEvent.setup()
}

async function openFromList() {
  const user = openAt('/list')
  await user.click(screen.getByRole('link', { name: '추가' }))
  await screen.findByRole('heading', { name: '계좌 추가' })
  return user
}

const name = () => screen.getByLabelText<HTMLInputElement>('이름')
const closeButton = () => screen.getByRole('button', { name: '닫기' })
const dialog = () => screen.queryByRole<HTMLDialogElement>('dialog', { name: question })
const path = () => router.state.location.pathname
const toggleBusy = () => fireEvent.click(screen.getByText('처리 바꾸기'))
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)))

type User = ReturnType<typeof userEvent.setup>

/** 닫는 세 가지 길 */
const ways: [string, (user: User) => Promise<unknown>][] = [
  ['닫기(X)', (user) => user.click(closeButton())],
  ['브라우저의 뒤로', () => act(() => router.navigate(-1))],
  ['Esc', (user) => user.keyboard('{Escape}')],
]

describe('전체 화면 입력의 틀', () => {
  it('머리의 왼쪽은 "닫기", 가운데는 화면 이름(h1)이고 내용과 저장 자리는 한 양식 안에 있다', () => {
    openAt('/new')
    const head = screen.getByRole('banner')
    expect(within(head).getByRole('button', { name: '닫기' })).toBe(closeButton())
    expect(within(head).getByRole('heading', { level: 1, name: '계좌 추가' })).toBeTruthy()
    const form = name().closest('form')!
    expect(screen.getByRole('main').contains(form)).toBe(true)
    expect(form.contains(screen.getByRole('button', { name: '저장' }))).toBe(true)
    expect(form.noValidate).toBe(true)
  })

  it('저장을 누르거나 칸에서 엔터를 누르면 한 번 알리고 페이지를 새로 열지 않는다', async () => {
    const user = openAt('/new')
    await user.click(screen.getByRole('button', { name: '저장' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    await user.type(name(), '{Enter}')
    expect(onSubmit).toHaveBeenCalledTimes(2)
    expect(fireEvent.submit(name().closest('form')!)).toBe(false)
  })

  it('버튼을 누르는 동안 초점을 칸에 남겨 오류 문구로 버튼이 밀리지 않게 한다', async () => {
    const user = openAt('/new')
    await user.click(name())
    await user.pointer({ keys: '[MouseLeft>]', target: screen.getByRole('button', { name: '저장' }) })
    expect(document.activeElement).toBe(name())
  })

  it('처리 중에만 화면에 aria-busy를 단다', () => {
    openAt('/new')
    const frame = screen.getByRole('main').parentElement!
    expect(frame.hasAttribute('aria-busy')).toBe(false)
    toggleBusy()
    expect(frame.getAttribute('aria-busy')).toBe('true')
  })

  it('여는 때 초점을 옮기지 않는다', async () => {
    await openFromList()
    expect(document.activeElement).toBe(document.body)
  })
})

describe('바꾼 값이 없으면', () => {
  it.each(ways)('%s로 묻지 않고 앞 화면으로 돌아간다', async (_, close) => {
    const user = await openFromList()
    await close(user)
    await screen.findByText('목록')
    expect(router.state.historyAction).toBe('POP')
    expect(dialog()).toBeNull()
  })

  it.each([ways[0], ways[2]])('주소를 바로 열었으면 %s로 부모 화면에 replace로 간다', async (_, close) => {
    const user = openAt('/new')
    await close(user)
    await screen.findByText('목록')
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it('바꿨다가 되돌린 값은 바꾸지 않은 것이다', async () => {
    const user = await openFromList()
    await user.type(name(), '가{Backspace}')
    await user.click(closeButton())
    await screen.findByText('목록')
  })

  it('다른 링크로 나가는 것도 막지 않는다', async () => {
    const user = await openFromList()
    await user.click(screen.getByRole('link', { name: '다른 화면' }))
    expect(await screen.findByText('다른 내용')).toBeTruthy()
  })
})

describe('바꾼 값이 있으면', () => {
  it.each(ways)('%s는 확인 창을 띄우고 화면과 값이 그대로다', async (_, close) => {
    const user = await openFromList()
    await user.type(name(), '급여통장')
    await close(user)
    expect(await screen.findByRole('dialog', { name: question })).toBeTruthy()
    expect(screen.getByText('저장하지 않은 내용은 사라져요')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '계속 쓰기' }))
    expect(path()).toBe('/new')
    // 뒤로는 브라우저가 옮긴 주소를 되돌린다
    await waitFor(() => expect(window.location.pathname).toBe('/new'))
    expect(name().value).toBe('급여통장')
  })

  it.each(ways)('%s 뒤에 "버리기"를 누르면 나간다', async (_, close) => {
    const user = await openFromList()
    await user.type(name(), '급여통장')
    await close(user)
    await screen.findByRole('dialog', { name: question })
    await untilOpened()
    await user.click(screen.getByRole('button', { name: '버리기' }))
    await screen.findByText('목록')
    await waitFor(() => expect(window.location.pathname).toBe('/list'))
    expect(document.querySelector('dialog')).toBeNull()
  })

  it.each(ways)('%s 뒤에 "계속 쓰기"를 누르면 남고, 다시 닫으면 또 묻는다', async (_, close) => {
    const user = await openFromList()
    await user.type(name(), '급여통장')
    await close(user)
    await screen.findByRole('dialog', { name: question })
    await untilOpened()
    await user.click(screen.getByRole('button', { name: '계속 쓰기' }))
    await waitFor(() => expect(dialog()).toBeNull())
    expect(path()).toBe('/new')
    expect(window.location.pathname).toBe('/new')
    expect(name().value).toBe('급여통장')
    await close(user)
    expect(await screen.findByRole('dialog', { name: question })).toBeTruthy()
  })

  it.each([
    ['시트의 X', (user) => user.click(within(dialog()!).getByRole('button', { name: '닫기' }))],
    ['가림막', (user) => user.click(dialog()!)],
    ['Esc', (user) => user.keyboard('{Escape}')],
  ] as [string, (user: User) => Promise<unknown>][])('확인 창의 %s는 "계속 쓰기"와 같다', async (_, dismiss) => {
    const user = await openFromList()
    await user.type(name(), '급여통장')
    await user.click(closeButton())
    await untilOpened()
    await dismiss(user)
    await waitFor(() => expect(dialog()).toBeNull())
    await settle()
    expect(dialog()).toBeNull()
    expect(path()).toBe('/new')
  })

  it('묻는 동안 브라우저의 뒤로를 눌러도 하나만 묻고, "버리기"면 나간다', async () => {
    const user = await openFromList()
    await user.type(name(), '급여통장')
    await user.click(closeButton())
    await untilOpened()
    await act(() => router.navigate(-1))
    await settle()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: '버리기' }))
    await screen.findByText('목록')
  })

  it('다른 링크로 나갈 때도 묻고, "버리기"면 그 주소로 간다', async () => {
    const user = await openFromList()
    await user.type(name(), '급여통장')
    await user.click(screen.getByRole('link', { name: '다른 화면' }))
    expect(path()).toBe('/new')
    await untilOpened()
    await user.click(screen.getByRole('button', { name: '버리기' }))
    expect(await screen.findByText('다른 내용')).toBeTruthy()
  })

  it('주소를 바로 열었으면 "버리기"는 부모 화면에 replace로 간다', async () => {
    const user = openAt('/new')
    await user.type(name(), '급여통장')
    await user.click(closeButton())
    await untilOpened()
    await user.click(screen.getByRole('button', { name: '버리기' }))
    await screen.findByText('목록')
    expect(router.state.historyAction).toBe('REPLACE')
  })
})

describe('두 번 누르기', () => {
  /** 홈에서 목록으로, 목록에서 입력으로 온다. */
  async function openFromHome() {
    const user = openAt('/home')
    await user.click(screen.getByRole('link', { name: '목록으로' }))
    await user.click(await screen.findByRole('link', { name: '추가' }))
    await screen.findByRole('heading', { name: '계좌 추가' })
    return user
  }

  it('닫기를 두 번 눌러도 한 화면만 돌아간다', async () => {
    const user = await openFromHome()
    await user.dblClick(closeButton())
    await screen.findByText('목록')
    await settle()
    expect(path()).toBe('/list')
  })

  it.each([
    ['닫기로 묻고', (user: User) => user.click(closeButton())],
    ['뒤로로 묻고', () => act(() => router.navigate(-1))],
  ])('%s "버리기"를 두 번 눌러도 한 화면만 돌아간다', async (_, close) => {
    const user = await openFromHome()
    await user.type(name(), '급여통장')
    await close(user)
    await screen.findByRole('dialog', { name: question })
    await untilOpened()
    await user.dblClick(screen.getByRole('button', { name: '버리기' }))
    await screen.findByText('목록')
    await settle()
    expect(path()).toBe('/list')
  })
})

describe('떠난 뒤', () => {
  it.each(ways)('%s로 떠나면 이어서 누른 것이 앞 화면에 닿지 않게 잠깐 덮는다', async (_, close) => {
    const user = await openFromList()
    expect(shield()).toBeNull()
    await close(user)
    await screen.findByText('목록')
    expect(fireEvent.mouseDown(shield()!)).toBe(false)
    expect(fireEvent.touchStart(shield()!)).toBe(false)
    await untilUnshielded()
  })

  it('저장을 마치고 떠나도 같다', async () => {
    const user = await openFromList()
    await user.click(screen.getByRole('button', { name: '저장을 마침' }))
    await screen.findByText('목록')
    expect(shield()).toBeTruthy()
  })
})

describe('Esc', () => {
  function pressEscape(init: KeyboardEventInit) {
    const event = createEvent.keyDown(name(), { key: 'Escape', bubbles: true, cancelable: true, ...init })
    if (init.isComposing) Object.defineProperty(event, 'isComposing', { value: true })
    if (init.keyCode) Object.defineProperty(event, 'keyCode', { value: init.keyCode })
    act(() => void fireEvent(name(), event))
  }

  it('한글을 조합하는 중이면 무시한다', async () => {
    await openFromList()
    pressEscape({ isComposing: true })
    await settle()
    expect(path()).toBe('/new')
  })

  it('조합이 끝났다고 먼저 알리는 브라우저(Safari)에서도 조합을 끝낸 Esc면 무시한다', async () => {
    await openFromList()
    pressEscape({ keyCode: 229 })
    await settle()
    expect(path()).toBe('/new')
  })

  it('누르고 있어 되풀이되는 것은 무시한다. 확인 창을 닫은 Esc가 다시 묻지 않는다', async () => {
    await openFromList()
    pressEscape({ repeat: true })
    await settle()
    expect(path()).toBe('/new')
  })

  it('열린 모달이 있으면 화면은 무시한다', async () => {
    await openFromList()
    const other = document.createElement('dialog')
    document.body.append(other)
    other.showModal()
    pressEscape({})
    await settle()
    expect(path()).toBe('/new')
    expect(other.open).toBe(false)
    other.remove()
    pressEscape({})
    await screen.findByText('목록')
  })

  it('다른 키는 보지 않는다', async () => {
    const user = await openFromList()
    await user.keyboard('a{Enter}')
    await settle()
    expect(path()).toBe('/new')
  })

  it('화면을 떠나면 받지 않는다', async () => {
    const user = await openFromList()
    await user.keyboard('{Escape}')
    await screen.findByText('목록')
    await user.keyboard('{Escape}')
    await settle()
    expect(path()).toBe('/list')
  })
})

describe('처리 중', () => {
  it.each(ways)('%s를 눌러도 닫지 않고 묻지 않는다', async (_, close) => {
    const user = await openFromList()
    await user.type(name(), '급여통장')
    toggleBusy()
    const dom = recordDom()
    await close(user)
    await settle()
    expect(path()).toBe('/new')
    expect(window.location.pathname).toBe('/new')
    expect(dom.sawElement('dialog')).toBe(false)
  })

  it('바꾼 값이 없어도 닫지 않는다', async () => {
    const user = await openFromList()
    toggleBusy()
    for (const [, close] of ways) await close(user)
    await settle()
    expect(path()).toBe('/new')
  })

  it('막은 뒤에 처리가 실패로 끝나면 그때는 묻지 않고, 다시 닫으면 묻는다', async () => {
    const user = await openFromList()
    await user.type(name(), '급여통장')
    toggleBusy()
    await act(() => router.navigate(-1))
    await settle()
    toggleBusy()
    await settle()
    expect(dialog()).toBeNull()
    await user.click(closeButton())
    expect(dialog()).toBeTruthy()
  })
})

describe('막지 않고 나가기', () => {
  it('바꾼 값이 있고 처리 중이어도 스스로 나가는 것은 막지 않는다', async () => {
    const user = await openFromList()
    await user.type(name(), '급여통장')
    toggleBusy()
    await user.click(screen.getByRole('button', { name: '저장을 마침' }))
    await screen.findByText('목록')
    expect(dialog()).toBeNull()
  })

  it('새로 고침과 탭 닫기는 막지 않는다', async () => {
    const user = await openFromList()
    await user.type(name(), '급여통장')
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})

describe('화면 키보드', () => {
  function installVisualViewport(height: number) {
    const viewport = Object.assign(new EventTarget(), { height, offsetTop: 0, scale: 1 })
    vi.stubGlobal('visualViewport', viewport)
    return {
      viewport,
      change(next: Partial<{ height: number; offsetTop: number; scale: number }>, type = 'resize') {
        Object.assign(viewport, next)
        act(() => void viewport.dispatchEvent(new Event(type)))
      },
    }
  }
  const frame = () => screen.getByRole('main').parentElement!
  const area = () => [frame().style.getPropertyValue('--visible-top'), frame().style.getPropertyValue('--visible-height')]

  it('보이는 영역에 맞춰 저장 자리가 키보드 위로 올라온다', () => {
    const { change } = installVisualViewport(844)
    openAt('/new')
    expect(area()).toEqual(['0px', '844px'])
    change({ height: 508 })
    expect(area()).toEqual(['0px', '508px'])
    change({ offsetTop: 120 }, 'scroll')
    expect(area()).toEqual(['120px', '508px'])
    change({ height: 844, offsetTop: 0 })
    expect(area()).toEqual(['0px', '844px'])
    const rule = readCssRule(CSS, '.screen')
    expect(rule).toContain('position: fixed')
    expect(rule).toContain('top: var(--visible-top, 0)')
    expect(rule).toContain('height: var(--visible-height, 100dvh)')
  })

  it('두 손가락으로 확대해 보는 동안에는 줄이지 않는다', () => {
    const { change } = installVisualViewport(844)
    openAt('/new')
    change({ height: 422, scale: 2 })
    expect(area()).toEqual(['', ''])
    change({ height: 844, scale: 1.0000001 })
    expect(area()).toEqual(['0px', '844px'])
  })

  it('줄어든 뒤에도 쓰던 칸이 보이게 한다', async () => {
    const { change } = installVisualViewport(844)
    const user = openAt('/new')
    await user.click(name())
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    change({ height: 508 })
    expect(scroll.mock.contexts).toEqual([name()])
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('화면을 떠나면 더 듣지 않는다', async () => {
    const { viewport } = installVisualViewport(844)
    const remove = vi.spyOn(viewport, 'removeEventListener')
    const user = await openFromList()
    await user.keyboard('{Escape}')
    await screen.findByText('목록')
    expect(remove.mock.calls.map(([type]) => type).toSorted()).toEqual(['resize', 'scroll'])
  })

  it('보이는 영역을 알려 주지 않는 브라우저에서는 화면 높이를 쓴다', () => {
    vi.stubGlobal('visualViewport', null)
    openAt('/new')
    expect(area()).toEqual(['', ''])
  })
})

/* 되돌리기가 있는 토스트는 이 화면을 열어도 남아 저장 자리 위 16px에 놓인다(00-common 5.7, designer 결정 #102) */
describe('남은 토스트의 자리', () => {
  const resized: (() => void)[] = []
  const observed: Element[] = []
  let bottomHeight = 72

  beforeEach(() => {
    resized.length = 0
    observed.length = 0
    bottomHeight = 72
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resized.push(callback)
        }
        observe(element: Element) {
          observed.push(element)
        }
        disconnect() {
          resized.length = 0
        }
      },
    )
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(844)
    // 저장 자리는 양식의 마지막 칸이다
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.parentElement?.tagName === 'FORM' && this.parentElement.lastElementChild === this ? bottomHeight : 0
    })
  })

  function installVisualViewport(height: number) {
    const viewport = Object.assign(new EventTarget(), { height, offsetTop: 0, scale: 1 })
    vi.stubGlobal('visualViewport', viewport)
    return (next: Partial<{ height: number; offsetTop: number; scale: number }>, type = 'resize') => {
      Object.assign(viewport, next)
      act(() => void viewport.dispatchEvent(new Event(type)))
    }
  }

  const offset = () => document.documentElement.style.getPropertyValue('--toast-above-form')
  const bottomArea = () => screen.getByRole('button', { name: '저장' }).parentElement!

  it('저장 자리의 높이를 알린다. 화면이 올라오는 움직임과 상관없다', () => {
    vi.stubGlobal('visualViewport', null)
    openAt('/new')
    expect(offset()).toBe('72px')
  })

  it('화면 키보드가 올라오면 보이는 영역 아래의 틈을 더한다', () => {
    const change = installVisualViewport(844)
    openAt('/new')
    expect(offset()).toBe('72px')
    change({ height: 508 })
    expect(offset()).toBe(`${72 + 844 - 508}px`)
    change({ offsetTop: 120 }, 'scroll')
    expect(offset()).toBe(`${72 + 844 - 508 - 120}px`)
    change({ height: 844, offsetTop: 0 })
    expect(offset()).toBe('72px')
  })

  it('두 손가락으로 확대해 보는 동안에는 틈을 더하지 않는다', () => {
    const change = installVisualViewport(844)
    openAt('/new')
    change({ height: 422, scale: 2 })
    expect(offset()).toBe('72px')
  })

  it('저장 자리의 크기가 바뀌면(오류 문구, 글자 크기) 다시 잰다', () => {
    vi.stubGlobal('visualViewport', null)
    openAt('/new')
    expect(observed).toEqual([bottomArea()])
    bottomHeight = 120
    act(() => resized.forEach((callback) => callback()))
    expect(offset()).toBe('120px')
  })

  it('화면을 떠나면 지우고 더 재지 않는다', async () => {
    const user = await openFromList()
    expect(offset()).not.toBe('')
    await user.keyboard('{Escape}')
    await screen.findByText('목록')
    expect(offset()).toBe('')
    expect(resized).toEqual([])
  })
})

describe('모양', () => {
  const styleOf = (element: Element) => getComputedStyle(element)

  it.each([320, 390, 768])('폭 %dpx에서 화면 전체를 덮고 아래에서 200ms 동안 올라온다', (width) => {
    openAt('/new')
    setViewportWidth(width)
    const frame = styleOf(screen.getByRole('main').parentElement!)
    expect(frame.position).toBe('fixed')
    expect(frame.backgroundColor).toBe('var(--color-bg)')
    expect(readCssRule(CSS, '.screen')).toContain(
      'animation: rise var(--motion-sheet-duration) var(--motion-sheet-easing)',
    )
    expect(readCssRule(CSS, 'from')).toContain('translate: 0 100%')
  })

  it('다 올라온 뒤에 움직임을 남기지 않는다', () => {
    const css = readWebFile(CSS)
    expect(css).not.toMatch(/animation-fill-mode|forwards|both|will-change|transform:/)
    expect(css.match(/translate:/g)).toHaveLength(1)
  })

  it('휴대폰 배치의 머리는 면 색 바탕과 아래 1px 선이고 화면 이름이 가운데 제목 크기다', () => {
    openAt('/new')
    setViewportWidth(390)
    const head = styleOf(screen.getByRole('banner'))
    expect(head.backgroundColor).toBe('var(--color-surface)')
    expect(readCssRule(CSS, '.head')).toContain('border-bottom: 1px solid var(--color-border)')
    expect(head.minHeight).toBe('calc(var(--size-topbar) + env(safe-area-inset-top))')
    expect(head.getPropertyValue('grid-template-columns')).toBe('minmax(max-content, 1fr) auto minmax(0, 1fr)')
    // 뒤로 버튼과 같이 안쪽 여백만큼 당겨 아이콘을 내용의 왼쪽 선에 맞춘다
    expect(styleOf(closeButton().parentElement!).getPropertyValue('margin-inline-start')).toBe(
      'calc(-1 * var(--space-12))',
    )
  })

  it('칸만 스크롤하고 저장 자리는 맨 아래다. 낮은 화면에서도 칸 하나는 보인다', () => {
    openAt('/new')
    const main = screen.getByRole('main')
    expect(styleOf(main.parentElement!).getPropertyValue('grid-template-rows')).toBe('auto minmax(0, 1fr)')
    expect(styleOf(main).getPropertyValue('grid-template-rows')).toBe('minmax(0, 1fr)')
    expect(styleOf(main).overflowY).toBe('auto')
    const form = styleOf(name().closest('form')!)
    expect(form.display).toBe('grid')
    expect(form.getPropertyValue('grid-template-rows')).toBe('minmax(calc(2 * var(--size-field)), 1fr) auto')
    const [fields, bottom] = name().closest('form')!.children
    expect(styleOf(fields).overflowY).toBe('auto')
    expect(styleOf(fields).gap).toBe('var(--space-16)')
    expect(styleOf(fields).getPropertyValue('padding-block')).toBe('var(--space-24)')
    expect(styleOf(bottom).backgroundColor).toBe('var(--color-surface)')
    expect(styleOf(bottom).getPropertyValue('padding-block')).toBe(
      'var(--space-12) calc(var(--space-12) + env(safe-area-inset-bottom))',
    )
    expect(readCssRule(CSS, '.bottom')).toContain('border-top: 1px solid var(--color-border)')
  })

  it('넓은 화면은 내용 영역 안 폭 560px이고 머리에 바탕과 선이 없으며 움직임이 없다', () => {
    openAt('/new')
    setViewportWidth(1280)
    const [fields, bottom] = name().closest('form')!.children
    for (const area of [screen.getByRole('banner'), fields, bottom]) {
      expect(styleOf(area).getPropertyValue('--content-width')).toBe('var(--width-full-screen-form)')
    }
    const frame = styleOf(screen.getByRole('main').parentElement!)
    expect(frame.position).toBe('relative')
    expect(frame.animation).toBe('none')
    expect(frame.backgroundColor).toBe('rgba(0, 0, 0, 0)')
    const head = styleOf(screen.getByRole('banner'))
    expect(head.backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(head.borderBottomWidth).toBe('0px')
    // 저장 자리의 바탕과 선은 내용 영역 전체 폭이고 버튼만 560px 안이다
    expect(styleOf(bottom).backgroundColor).toBe('var(--color-surface)')
    expect(styleOf(bottom).getPropertyValue('padding-inline')).toContain('(100% - var(--content-width)) / 2')
  })

  it.each([
    [390, '100%'],
    [768, 'var(--width-content-narrow)'],
  ])('폭 %dpx의 내용 폭은 %s다', (width, expected) => {
    openAt('/new')
    setViewportWidth(width)
    const fields = name().closest('form')!.firstElementChild!
    expect(styleOf(fields).getPropertyValue('--content-width')).toBe(expected)
  })
})
