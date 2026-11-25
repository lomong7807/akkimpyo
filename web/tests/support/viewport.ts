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
