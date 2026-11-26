import { afterEach, describe, expect, it } from 'vitest'
import { readWebFile } from './support/webFile'

// 값은 docs/design/tokens.md와 글자 그대로 같아야 한다.
const colors = {
  '--color-bg': ['#F6F7F8', '#0F1214'],
  '--color-surface': ['#FFFFFF', '#181C1F'],
  '--color-inverse': ['#15181B', '#ECEFF1'],
  '--color-scrim': ['rgba(15, 18, 20, 0.40)', 'rgba(0, 0, 0, 0.60)'],
  '--color-text': ['#15181B', '#ECEFF1'],
  '--color-text-secondary': ['#5B6670', '#98A3AC'],
  '--color-on-accent': ['#FFFFFF', '#0F1214'],
  '--color-on-danger': ['#FFFFFF', '#0F1214'],
  '--color-on-inverse': ['#FFFFFF', '#0F1214'],
  '--color-inverse-action': ['#3CCB9E', '#0F7B5F'],
  '--color-border': ['#E4E7EA', '#2A3035'],
  '--color-border-strong': ['#808B94', '#646E77'],
  '--color-accent': ['#0F7B5F', '#3CCB9E'],
  '--color-danger': ['#C4372C', '#F0796E'],
  '--color-accent-weak': ['#E7F3EE', '#16322A'],
  '--color-press': ['#EFF1F3', '#21262A'],
} as const

const shadows = {
  '--shadow-quick-entry': ['0 4px 12px rgba(15, 18, 20, 0.16)', '0 4px 12px rgba(0, 0, 0, 0.48)'],
  '--shadow-sheet': ['0 -2px 16px rgba(15, 18, 20, 0.12)', '0 -2px 16px rgba(0, 0, 0, 0.48)'],
  '--shadow-dialog': ['0 8px 24px rgba(15, 18, 20, 0.12)', '0 8px 24px rgba(0, 0, 0, 0.48)'],
} as const

/** 글자 토큰: [굵기, 크기(px), 줄 높이(px)] */
const texts = {
  '--text-hero': [700, 32, 40],
  '--text-title': [700, 20, 28],
  '--text-body': [400, 16, 24],
  '--text-body-strong': [600, 16, 24],
  '--text-label': [600, 14, 20],
  '--text-secondary': [400, 14, 20],
  '--text-caption': [400, 13, 18],
} as const

const spaces = {
  '--space-4': 4,
  '--space-8': 8,
  '--space-12': 12,
  '--space-16': 16,
  '--space-24': 24,
  '--space-32': 32,
  '--space-40': 40,
} as const

const sizes = {
  '--size-topbar': 56,
  '--size-tabbar': 56,
  '--size-quick-entry': 44,
  '--size-button': 48,
  '--size-button-secondary': 44,
  '--size-field': 48,
  '--size-touch': 44,
  '--size-chip': 24,
  '--size-chip-choice': 32,
  '--size-icon-20': 20,
  '--size-icon-24': 24,
  '--size-row': 56,
  '--size-toast': 56,
  '--size-sheet-handle': 36,
} as const

const widths = {
  '--width-content-narrow': 640,
  '--width-content-wide': 720,
  '--width-auth': 400,
  '--width-sidebar': 240,
  '--width-list-min': 360,
  '--width-side-panel': 440,
  '--width-field-panel': 320,
  '--width-full-screen-form': 560,
  '--width-dialog': 480,
  '--width-toast': 480,
} as const

interface Situation {
  systemDark?: boolean
  reducedMotion?: boolean
  dataTheme?: 'light' | 'dark'
}

function mediaMatches(media: string, { systemDark, reducedMotion }: Situation): boolean {
  if (media === '(prefers-color-scheme: dark)') return systemDark ?? false
  if (media === '(prefers-reduced-motion: reduce)') return reducedMotion ?? false
  throw new Error(`테스트가 모르는 미디어 조건: ${media}`)
}

/**
 * 주어진 상황에서 문서 루트에 적용되는 토큰 값을 읽는다.
 * jsdom은 `prefers-*` 조건을 계산하지 않으므로 맞는 조건의 규칙만 같은 순서로 펼쳐 넣고,
 * 선택자와 우선순위 계산은 jsdom에 맡긴다.
 */
function tokensIn(situation: Situation = {}): (name: string) => string {
  const style = document.createElement('style')
  document.head.append(style)
  style.textContent = readWebFile('src/styles/tokens.css')
  style.textContent = [...style.sheet!.cssRules]
    .flatMap((rule) => {
      if (!(rule instanceof CSSMediaRule)) return [rule]
      return mediaMatches(rule.media.mediaText, situation) ? [...rule.cssRules] : []
    })
    .map((rule) => rule.cssText)
    .join('\n')

  if (situation.dataTheme) document.documentElement.dataset.theme = situation.dataTheme
  const computed = getComputedStyle(document.documentElement)
  return (name) => compact(computed.getPropertyValue(name))
}

/** jsdom은 쉼표 뒤와 음수 앞의 공백을 지워서 돌려준다. 뜻이 같은 값끼리 비교하려고 기대 값도 같은 모양으로 맞춘다. */
function compact(value: string): string {
  return value.trim().replace(/\s+(?=-)|(?<=,)\s+/g, '')
}

function declaredNames(prefix: string): string[] {
  const names = [...readWebFile('src/styles/tokens.css').matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((match) => match[1])
  return [...new Set(names)].filter((name) => name.startsWith(prefix)).sort()
}

function rem(px: number): string {
  return `${px / 16}rem`
}

afterEach(() => {
  document.head.replaceChildren()
  document.documentElement.removeAttribute('data-theme')
})

describe('색과 그림자', () => {
  const themed = Object.entries({ ...colors, ...shadows })

  it.each(themed)('%s의 밝은 화면 값과 어두운 화면 값', (name, [light, dark]) => {
    expect(tokensIn()(name)).toBe(compact(light))
    document.head.replaceChildren()
    expect(tokensIn({ systemDark: true })(name)).toBe(compact(dark))
  })

  it('문서에 없는 색과 그림자가 없다', () => {
    expect(declaredNames('--color-')).toEqual(Object.keys(colors).sort())
    expect(declaredNames('--shadow-')).toEqual(Object.keys(shadows).sort())
  })
})

describe('테마', () => {
  it.each([
    { systemDark: false, dataTheme: undefined, expected: 'light' },
    { systemDark: true, dataTheme: undefined, expected: 'dark' },
    { systemDark: false, dataTheme: 'light', expected: 'light' },
    { systemDark: true, dataTheme: 'light', expected: 'light' },
    { systemDark: false, dataTheme: 'dark', expected: 'dark' },
    { systemDark: true, dataTheme: 'dark', expected: 'dark' },
  ] as const)(
    '시스템이 어두움=$systemDark, data-theme=$dataTheme 이면 $expected 값이 모두 적용된다',
    ({ systemDark, dataTheme, expected }) => {
      const token = tokensIn({ systemDark, dataTheme })
      const column = expected === 'light' ? 0 : 1
      for (const [name, values] of Object.entries({ ...colors, ...shadows })) {
        expect(token(name), name).toBe(compact(values[column]))
      }
      // 스크롤바와 입력칸 같은 브라우저 기본 요소도 같은 테마로 그린다.
      expect(token('color-scheme')).toBe(expected)
    },
  )
})

describe('글자', () => {
  it.each(Object.entries(texts))('%s는 굵기, 크기, 줄 높이를 한 변수에 담고 rem을 쓴다', (name, [weight, size, line]) => {
    expect(tokensIn()(name)).toBe(`${weight} ${rem(size)}/${rem(line)} var(--font-family)`)
  })

  it('글자 단계는 7개뿐이다', () => {
    expect(declaredNames('--text-')).toEqual(Object.keys(texts).sort())
  })

  it('글꼴은 Pretendard Variable이고 대체 글꼴 순서는 설계서 2.3과 같다', () => {
    expect(tokensIn()('--font-family')).toBe(
      compact('"Pretendard Variable", -apple-system, "Apple SD Gothic Neo", system-ui, sans-serif'),
    )
  })
})

describe('간격, 모서리, 크기, 선', () => {
  it.each(Object.entries({ ...spaces, ...sizes, ...widths }))('%s는 %dpx를 rem으로 쓴 값이다', (name, px) => {
    expect(tokensIn()(name)).toBe(rem(px))
  })

  it('간격은 척도의 일곱 값뿐이다', () => {
    expect(declaredNames('--space-')).toEqual(Object.keys(spaces).sort())
  })

  it('모서리는 10px, 12px, 완전히 둥글게 세 값뿐이다', () => {
    const token = tokensIn()
    expect(token('--radius-10')).toBe(rem(10))
    expect(token('--radius-12')).toBe(rem(12))
    expect(token('--radius-full')).toBe('9999px')
    expect(declaredNames('--radius-')).toHaveLength(3)
  })

  it('초점 테두리와 강조 선의 2px는 변수로 있다 (T-1)', () => {
    const token = tokensIn()
    expect(token('--focus-ring-width')).toBe('2px')
    expect(token('--focus-ring-offset')).toBe('2px')
    expect(token('--border-width-strong')).toBe('2px')
  })
})

describe('움직임', () => {
  it('시트 200ms, 누름 100ms와 0.98배, 토스트 150ms, 처리 중 원 800ms', () => {
    const token = tokensIn()
    expect(token('--motion-sheet-duration')).toBe('200ms')
    expect(token('--motion-sheet-easing')).toBe(compact('cubic-bezier(0.2, 0, 0, 1)'))
    expect(token('--motion-press-duration')).toBe('100ms')
    expect(token('--motion-press-scale')).toBe('0.98')
    expect(token('--motion-toast-duration')).toBe('150ms')
    expect(token('--motion-spinner-duration')).toBe('800ms')
  })

  it('움직임 줄이기를 켜면 눌러도 크기가 바뀌지 않는다', () => {
    expect(tokensIn({ reducedMotion: true })('--motion-press-scale')).toBe('1')
  })
})
