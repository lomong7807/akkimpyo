import { act, cleanup, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Skeleton, { LoadingStatus, SkeletonBar, SkeletonSpace } from '../src/components/Skeleton'
import { useLoadingMessage } from '../src/components/useLoadingMessage'
import { recordDom } from './support/recordDom'
import { readWebFile } from './support/webFile'

const loading = '불러오고 있어요.'

beforeEach(() => void vi.useFakeTimers())

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const pass = (ms: number) => act(() => vi.advanceTimersByTime(ms))

function open() {
  return render(
    <main>
      <Skeleton>
        <h2>모양</h2>
      </Skeleton>
    </main>,
  )
}

describe('뼈대(00-common 4.5)', () => {
  it('300ms까지는 빈 자리이고 그 뒤에 보인다', () => {
    open()
    pass(299)
    expect(screen.getByRole('main').textContent).toBe('')
    pass(1)
    expect(screen.getByText('모양')).toBeTruthy()
  })

  it('화면 읽기에는 "불러오고 있어요."만 한 번 알리고 모양은 읽히지 않는다', () => {
    open()
    const status = screen.getByRole('status')
    const dom = recordDom()
    pass(5000)
    expect(screen.getByRole('status')).toBe(status)
    expect(status.textContent).toBe(loading)
    expect(dom.sawText(loading)).toBe(true)
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.getByText('모양').closest('[aria-hidden="true"]')).toBeTruthy()
    expect(status.closest('[aria-hidden]')).toBeNull()
  })

  it('알리는 글은 눈에 보이지 않고 자리를 차지하지 않는다', () => {
    open()
    const style = getComputedStyle(screen.getByRole('status'))
    expect(style.position).toBe('absolute')
    expect(style.width).toBe('1px')
    expect(style.height).toBe('1px')
    expect(style.overflow).toBe('hidden')
    expect(style.getPropertyValue('clip-path')).toBe('inset(50%)')
  })

  it('보이기 전에 끝나면 시계를 남기지 않는다', () => {
    const { unmount } = open()
    pass(100)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('뼈대 막대', () => {
  /** 글자 한 줄의 자리와 그 안의 막대 */
  function lineAndBar(bar: ReactElement) {
    const line = render(bar).container.firstElementChild!
    return { line: getComputedStyle(line), bar: getComputedStyle(line.firstElementChild!) }
  }

  it.each([
    ['label', 'var(--text-label)'],
    ['body', 'var(--text-body)'],
    ['title', 'var(--text-title)'],
  ] as const)('%s 글자 한 줄의 자리를 차지하고 막대 높이는 그 글자 크기다', (text, font) => {
    const { line, bar } = lineAndBar(<SkeletonBar kind="name" text={text} />)
    expect(line.font).toBe(font)
    expect(bar.height).toBe('1em')
    expect(bar.display).toBe('inline-block')
    expect(bar.verticalAlign).toBe('middle')
  })

  it('이름 쪽은 줄의 40%다', () => {
    const { line } = lineAndBar(<SkeletonBar kind="name" text="body" />)
    expect(line.width).toBe('40%')
    expect(line.flex).toBe('0 0 auto')
  })

  it('금액 쪽은 줄의 24%이고 오른쪽 끝에 놓인다', () => {
    const { line } = lineAndBar(<SkeletonBar kind="amount" text="body" />)
    expect(line.width).toBe('24%')
    expect(line.getPropertyValue('margin-inline-start')).toBe('auto')
  })

  it('막대는 테두리 색이고 모서리는 10px이다', () => {
    const { bar } = lineAndBar(<SkeletonBar kind="name" text="body" />)
    expect(bar.backgroundColor).toBe('var(--color-border)')
    expect(bar.borderRadius).toBe('var(--radius-10)')
    expect(bar.width).toBe('100%')
  })

  it('멈춰 있다', () => {
    expect(readWebFile('src/components/Skeleton.module.css')).not.toMatch(/animation|transition|gradient|@keyframes/)
  })
})

describe('실제 내용 사이에 나뉜 뼈대', () => {
  function Split() {
    const message = useLoadingMessage()
    return (
      <main>
        <LoadingStatus message={message} />
        <h2>지출</h2>
        <SkeletonSpace shown={message !== undefined}>
          <span>막대</span>
        </SkeletonSpace>
        <h2>수입</h2>
        <SkeletonSpace shown={message !== undefined}>
          <span>막대</span>
        </SkeletonSpace>
      </main>
    )
  }
  const spaces = () => screen.getAllByText('막대').map((bar) => bar.parentElement!)

  it('300ms 전에도 자리를 차지하되 보이지 않고, 그 뒤 모두 함께 보인다', () => {
    render(<Split />)
    expect(spaces().map((space) => getComputedStyle(space).visibility)).toEqual(['hidden', 'hidden'])
    pass(299)
    expect(spaces().map((space) => getComputedStyle(space).visibility)).toEqual(['hidden', 'hidden'])
    pass(1)
    expect(spaces().map((space) => getComputedStyle(space).visibility)).not.toContain('hidden')
  })

  it('알림은 한 곳에서 한 번이고 뼈대는 읽히지 않는다. 소제목은 그대로 읽힌다', () => {
    render(<Split />)
    pass(300)
    expect(screen.getAllByRole('status').map((status) => status.textContent)).toEqual([loading])
    expect(spaces().every((space) => space.getAttribute('aria-hidden') === 'true')).toBe(true)
    expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual(['지출', '수입'])
  })
})
