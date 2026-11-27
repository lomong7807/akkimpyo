import { act } from '@testing-library/react'
import { vi } from 'vitest'

interface Watch {
  callback: IntersectionObserverCallback
  options: IntersectionObserverInit | undefined
  targets: Set<Element>
  observer: IntersectionObserver
}

/**
 * IntersectionObserver를 흉내 낸다(jsdom에는 없다). jsdom은 배치를 계산하지 않으므로 지켜보는 요소가 보이는지는
 * 테스트가 `show`와 `hide`로 정한다. 되돌릴 때는 `vi.unstubAllGlobals`를 부른다.
 */
export function installIntersectionObserver() {
  const watches = new Set<Watch>()

  class FakeIntersectionObserver {
    readonly root = null
    readonly rootMargin: string
    readonly thresholds = [0]
    readonly watch: Watch

    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.rootMargin = options?.rootMargin ?? '0px'
      this.watch = { callback, options, targets: new Set(), observer: this as unknown as IntersectionObserver }
      watches.add(this.watch)
    }

    observe(target: Element) {
      this.watch.targets.add(target)
    }

    unobserve(target: Element) {
      this.watch.targets.delete(target)
    }

    disconnect() {
      this.watch.targets.clear()
      watches.delete(this.watch)
    }

    takeRecords() {
      return []
    }
  }

  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)

  function report(isIntersecting: boolean) {
    for (const { callback, targets, observer } of [...watches]) {
      const entries = [...targets].map(
        (target) => ({ target, isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 }) as IntersectionObserverEntry,
      )
      if (entries.length > 0) callback(entries, observer)
    }
  }

  return {
    /** 지켜보는 요소가 모두 보이는 범위에 들어온다. */
    show: () => act(() => report(true)),
    /** 지켜보는 요소가 모두 보이는 범위를 벗어난다. */
    hide: () => act(() => report(false)),
    /** 지금 지켜보는 요소 */
    targets: () => [...watches].flatMap(({ targets }) => [...targets]),
    /** 지켜보기를 시작할 때 준 설정 */
    options: () => [...watches].map(({ options }) => options),
  }
}

export type Intersection = ReturnType<typeof installIntersectionObserver>
