import { vi } from 'vitest'

const originals = new Map<HTMLStyleElement, string>()

function matchesWidth(media: string, width: number): boolean {
  const minimum = /^\(width >= (\d+)px\)$/.exec(media)
  if (minimum) return width >= Number(minimum[1])
  if (media.startsWith('(prefers-') || media === '(hover: hover)') return false
  throw new Error(`테스트가 모르는 미디어 조건: ${media}`)
}

/**
 * 화면 폭이 `width`px일 때 걸리는 규칙만 남긴다. 되돌릴 때는 `resetViewport`를 부른다.
 * jsdom은 `@media`의 폭 조건을 계산하지 않으므로 맞는 조건의 규칙만 같은 순서로 펼쳐 넣고,
 * 선택자와 우선순위 계산은 jsdom에 맡긴다.
 */
export function setViewportWidth(width: number): void {
  resetViewport()
  for (const style of document.querySelectorAll('style')) {
    originals.set(style, style.textContent)
    style.textContent = [...style.sheet!.cssRules]
      .flatMap((rule) => {
        if (!(rule instanceof CSSMediaRule)) return [rule]
        return matchesWidth(rule.media.mediaText, width) ? [...rule.cssRules] : []
      })
      .map((rule) => rule.cssText)
      .join('\n')
  }
}

export function resetViewport(): void {
  for (const [style, css] of originals) style.textContent = css
  originals.clear()
}

/**
 * 창 폭이 `width`px인 matchMedia를 흉내 낸다(jsdom에는 없다). `resizeTo`로 창 폭을 바꾸면 결과가 바뀐 조건에만 알린다.
 * 되돌릴 때는 `vi.unstubAllGlobals`를 부른다.
 */
export function installMatchMedia(width: number) {
  const queries: { media: string; target: EventTarget }[] = []
  vi.stubGlobal('matchMedia', (media: string) => {
    const target = new EventTarget()
    queries.push({ media, target })
    return Object.defineProperty(target, 'matches', { get: () => matchesWidth(media, width) })
  })
  return {
    resizeTo(next: number) {
      const before = queries.map(({ media }) => matchesWidth(media, width))
      width = next
      queries.forEach(({ media, target }, index) => {
        if (matchesWidth(media, width) !== before[index]) target.dispatchEvent(new Event('change'))
      })
    },
  }
}
