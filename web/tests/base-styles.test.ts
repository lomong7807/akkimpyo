import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readWebFile, webPath } from './support/webFile'

function addStyle(css: string): CSSRule[] {
  const style = document.createElement('style')
  document.head.append(style)
  style.textContent = css
  return [...style.sheet!.cssRules]
}

function baseRules(): CSSRule[] {
  return addStyle(readWebFile('src/styles/base.css'))
}

/** jsdom은 var()를 풀지 않으므로 선언에 적은 토큰 이름을 그대로 읽는다. */
function styleOf(selector: string, rules = baseRules()): CSSStyleDeclaration {
  const rule = rules.find(
    (candidate): candidate is CSSStyleRule =>
      candidate instanceof CSSStyleRule && candidate.selectorText.replace(/\s+/g, ' ') === selector,
  )
  if (!rule) throw new Error(`${selector} 규칙이 없다`)
  return rule.style
}

afterEach(() => {
  document.head.replaceChildren()
  document.body.replaceChildren()
})

describe('기본 스타일', () => {
  it('화면 배경, 글자색, 글꼴은 토큰을 쓴다', () => {
    const body = styleOf('body')
    expect(body.getPropertyValue('background-color')).toBe('var(--color-bg)')
    expect(body.getPropertyValue('color')).toBe('var(--color-text)')
    expect(body.getPropertyValue('font')).toBe('var(--text-body)')
  })

  it('화면 제목은 text-title이다', () => {
    expect(styleOf('h1').getPropertyValue('font')).toBe('var(--text-title)')
  })

  it('버튼과 입력칸도 화면과 같은 글꼴을 쓴다', () => {
    expect(styleOf('button, input, select, textarea').getPropertyValue('font')).toBe('inherit')
  })

  it('키보드 초점은 2px 강조색 테두리를 2px 띄워 그린다', () => {
    const focus = styleOf(':focus-visible')
    expect(focus.getPropertyValue('outline')).toBe('var(--focus-ring-width) solid var(--color-accent)')
    expect(focus.getPropertyValue('outline-offset')).toBe('var(--focus-ring-offset)')
  })

  it('금액에 쓰는 tabular-nums는 같은 요소에 글자 토큰(font)을 함께 걸어도 남는다', () => {
    baseRules()
    // font 단축 속성은 font-variant-numeric을 normal로 되돌린다. jsdom은 이 되돌림을 흉내 내지 않아 직접 적는다.
    addStyle('.amount { font: 600 1rem/1.5rem sans-serif; font-variant-numeric: normal; }')
    const amount = document.createElement('span')
    amount.className = 'tabular-nums amount'
    amount.textContent = '12,000원'
    document.body.append(amount)
    expect(getComputedStyle(amount).fontVariantNumeric).toBe('tabular-nums')
  })

  it('움직임 줄이기를 켜면 모든 요소의 애니메이션과 전환이 바로 끝난다', () => {
    const media = baseRules().find(
      (rule): rule is CSSMediaRule =>
        rule instanceof CSSMediaRule && rule.media.mediaText === '(prefers-reduced-motion: reduce)',
    )
    const all = styleOf('*, ::before, ::after', [...(media?.cssRules ?? [])])
    for (const name of ['animation-duration', 'animation-delay', 'transition-duration', 'transition-delay']) {
      expect(all.getPropertyValue(name), name).toBe('0s')
      expect(all.getPropertyPriority(name), name).toBe('important')
    }
    expect(all.getPropertyValue('scroll-behavior')).toBe('auto')
  })
})

describe('글꼴', () => {
  const fontFace = () => /@font-face\s*{([^}]*)}/.exec(readWebFile('src/styles/fonts.css'))?.[1] ?? ''

  it('Pretendard Variable woff2를 레포에서 직접 준다', () => {
    expect(fontFace()).toContain('font-family: "Pretendard Variable"')
    const address = /url\("([^"]+)"\)/.exec(fontFace())?.[1] ?? ''
    const file = resolve(dirname(webPath('src/styles/fonts.css')), address)
    expect(readFileSync(file).subarray(0, 4).toString('latin1')).toBe('wOF2')
  })

  it('쓰는 굵기 400, 600, 700을 모두 이 파일 하나가 그린다', () => {
    const [min, max] = /font-weight:\s*(\d+) (\d+)/.exec(fontFace())?.slice(1).map(Number) ?? []
    expect(min).toBeLessThanOrEqual(400)
    expect(max).toBeGreaterThanOrEqual(700)
  })

  it('글꼴이 늦게 떠도 이미 그린 글자를 바꾸지 않는다', () => {
    expect(fontFace()).toContain('font-display: optional')
  })

  it('글꼴 라이선스(OFL) 파일이 함께 있다', () => {
    const license = readWebFile('src/assets/fonts/pretendard/LICENSE.txt')
    expect(license).toContain('SIL OPEN FONT LICENSE Version 1.1')
    expect(license).toContain('Kil Hyung-jin')
  })

  it.each(['fonts', 'tokens', 'base'])('%s.css는 다른 출처의 파일을 불러오지 않는다', (name) => {
    const css = readWebFile(`src/styles/${name}.css`).replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).not.toMatch(/https?:|@import|url\(\s*["']?\/\//)
  })
})
