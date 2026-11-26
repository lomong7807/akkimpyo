import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { use, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lazyScreen, type ScreenShell } from '../src/app/lazyScreen'
import { ShellShownContext } from '../src/components/shellShown'
import { recordDom } from './support/recordDom'

/*
 * 따로 싣는 화면(#251). 화면 코드를 받는 동안 그 화면의 틀(상단 바와 뼈대)을 그리고, 받지 못하면 틀 안에서 다시 시도하게 한다.
 * 화면 코드는 가짜(`load`)로 주고 언제 오거나 실패할지를 테스트가 정한다.
 */

const RELOADED = 'akkimpyo-screen-reload'
const failed = '불러오지 못했어요.'

function Frame({ children }: { children: ReactNode }) {
  return (
    <>
      <header>
        <h1>계좌</h1>
      </header>
      <main>{children}</main>
    </>
  )
}

const shell: ScreenShell = { Frame, Placeholder: () => <p>뼈대</p>, headingLevel: 2 }

function Page() {
  const afterShell = use(ShellShownContext)
  return (
    <main>
      <p>{afterShell ? '틀 다음의 화면' : '바로 그린 화면'}</p>
    </main>
  )
}

/** 테스트가 정할 때 오거나 실패하는 화면 코드 */
function screenCode() {
  const calls: { resolve: () => void; reject: () => void }[] = []
  const load = vi.fn(
    () =>
      new Promise<{ default: typeof Page }>((resolve, reject) => {
        calls.push({
          resolve: () => resolve({ default: Page }),
          reject: () => reject(new TypeError('Failed to fetch dynamically imported module')),
        })
      }),
  )
  return {
    load,
    arrive: () => act(async () => calls.at(-1)!.resolve()),
    fail: () => act(async () => calls.at(-1)!.reject()),
  }
}

const retryButton = () => screen.getByRole('button', { name: '다시 시도' })
const main = () => within(screen.getByRole('main'))

let reload: ReturnType<typeof vi.fn>

beforeEach(() => {
  sessionStorage.clear()
  reload = vi.fn()
  vi.stubGlobal('location', { ...window.location, reload })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('화면 코드를 받는 동안', () => {
  it('그 화면의 틀(상단 바)과 뼈대를 그리고, 오면 화면으로 바꾼다', async () => {
    const code = screenCode()
    const { Screen } = lazyScreen(code.load, shell)
    render(<Screen />)
    expect(screen.getByRole('heading', { level: 1, name: '계좌' })).toBeTruthy()
    expect(main().getByText('뼈대')).toBeTruthy()
    await code.arrive()
    expect(main().getByText('틀 다음의 화면')).toBeTruthy()
    expect(screen.queryByText('뼈대')).toBeNull()
    // 화면이 틀을 바꾸므로 틀의 상단 바는 남지 않는다
    expect(screen.queryByRole('heading', { level: 1, name: '계좌' })).toBeNull()
  })

  it('미리 받아 둔 화면은 틀 없이 처음부터 그린다', async () => {
    const code = screenCode()
    const { Screen, preload } = lazyScreen(code.load, shell)
    preload()
    await code.arrive()
    const dom = recordDom()
    render(<Screen />)
    expect(screen.getByText('바로 그린 화면')).toBeTruthy()
    expect(dom.sawText('뼈대')).toBe(false)
  })

  it('같은 화면 코드는 한 번만 받는다', async () => {
    const code = screenCode()
    const { Screen, preload } = lazyScreen(code.load, shell)
    preload()
    render(
      <>
        <Screen />
        <Screen />
      </>,
    )
    preload()
    await code.arrive()
    expect(screen.getAllByText('틀 다음의 화면')).toHaveLength(2)
    expect(screen.queryByText('뼈대')).toBeNull()
    expect(code.load).toHaveBeenCalledTimes(1)
  })
})

describe('화면 코드를 받지 못하면', () => {
  it('틀 안에 "불러오지 못했어요."와 "다시 시도"를 두고, 다시 시도하면 같은 코드를 다시 받는다', async () => {
    const user = userEvent.setup()
    const code = screenCode()
    const { Screen } = lazyScreen(code.load, shell)
    render(<Screen />)
    await code.fail()
    // 상단 바에 화면 이름(h1)이 있는 틀이라 안내의 제목은 h2다
    expect(main().getByRole('heading', { level: 2, name: failed })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: '계좌' })).toBeTruthy()
    await user.click(retryButton())
    expect(code.load).toHaveBeenCalledTimes(2)
    // 다시 받는 동안 안내는 그대로이고 버튼만 처리 중이다
    expect(main().getByRole('heading', { level: 2, name: failed })).toBeTruthy()
    expect(retryButton().getAttribute('aria-busy')).toBe('true')
    await code.arrive()
    expect(main().getByText('틀 다음의 화면')).toBeTruthy()
    expect(reload).not.toHaveBeenCalled()
  })

  it('다시 시도도 받지 못하면 연결이 있을 때 한 번 새로고침한다(배포로 파일이 바뀐 경우)', async () => {
    const user = userEvent.setup()
    const code = screenCode()
    const { Screen } = lazyScreen(code.load, shell)
    render(<Screen />)
    await code.fail()
    await user.click(retryButton())
    await code.fail()
    expect(reload).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem(RELOADED)).not.toBeNull()
    // 새로고침을 기다리는 동안 버튼은 처리 중이다
    expect(retryButton().getAttribute('aria-busy')).toBe('true')
  })

  it('이 탭에서 이미 새로고침했으면 다시 하지 않고 안내를 둔다', async () => {
    sessionStorage.setItem(RELOADED, '1')
    const user = userEvent.setup()
    const code = screenCode()
    const { Screen } = lazyScreen(code.load, shell)
    render(<Screen />)
    await code.fail()
    await user.click(retryButton())
    await code.fail()
    expect(reload).not.toHaveBeenCalled()
    expect(main().getByRole('heading', { level: 2, name: failed })).toBeTruthy()
    expect(retryButton().getAttribute('aria-busy')).toBeNull()
  })

  it('연결이 없으면 새로고침하지 않는다. 연결된 뒤 다시 시도하면 받는다', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const user = userEvent.setup()
    const code = screenCode()
    const { Screen } = lazyScreen(code.load, shell)
    render(<Screen />)
    await code.fail()
    await user.click(retryButton())
    await code.fail()
    expect(reload).not.toHaveBeenCalled()
    expect(retryButton().getAttribute('aria-busy')).toBeNull()
    onLine.mockReturnValue(true)
    await user.click(retryButton())
    await code.arrive()
    expect(main().getByText('틀 다음의 화면')).toBeTruthy()
  })

  it('저장소가 막혀 있으면 되풀이를 막을 수 없으므로 새로고침하지 않는다', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('막힘', 'SecurityError')
    })
    const user = userEvent.setup()
    const code = screenCode()
    const { Screen } = lazyScreen(code.load, shell)
    render(<Screen />)
    await code.fail()
    await user.click(retryButton())
    await code.fail()
    expect(reload).not.toHaveBeenCalled()
  })

  it('미리 받기가 받은 것으로는 새로고침 표시를 지우지 않는다(받지 못하는 화면에서 되풀이하지 않게)', async () => {
    sessionStorage.setItem(RELOADED, '1')
    const other = screenCode()
    lazyScreen(other.load, shell).preload()
    await other.arrive()
    expect(sessionStorage.getItem(RELOADED)).not.toBeNull()
    const user = userEvent.setup()
    const code = screenCode()
    const { Screen } = lazyScreen(code.load, shell)
    render(<Screen />)
    await code.fail()
    await user.click(retryButton())
    await code.fail()
    expect(reload).not.toHaveBeenCalled()
  })

  it('열린 화면이 자기 코드를 받으면 새로고침 표시를 지운다', async () => {
    sessionStorage.setItem(RELOADED, '1')
    const code = screenCode()
    const { Screen } = lazyScreen(code.load, shell)
    render(<Screen />)
    await code.arrive()
    expect(sessionStorage.getItem(RELOADED)).toBeNull()
  })

  it('실패를 남기지 않는다. 미리 받기가 실패해도 화면을 열면 다시 받는다', async () => {
    const code = screenCode()
    const { Screen, preload } = lazyScreen(code.load, shell)
    preload()
    await code.fail()
    render(<Screen />)
    expect(code.load).toHaveBeenCalledTimes(2)
    expect(main().getByText('뼈대')).toBeTruthy()
    await code.arrive()
    expect(main().getByText('틀 다음의 화면')).toBeTruthy()
  })

  it('미리 받기의 실패는 알리지 않는다', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    const code = screenCode()
    lazyScreen(code.load, shell).preload()
    await code.fail()
    await waitFor(() => new Promise((resolve) => setTimeout(resolve, 10)))
    expect(unhandled).not.toHaveBeenCalled()
    process.off('unhandledRejection', unhandled)
  })
})
