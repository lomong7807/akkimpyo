import { describe, expect, it } from 'vitest'
import { readWebFile, webPath } from './support/webFile'

const page = new DOMParser().parseFromString(readWebFile('index.html'), 'text/html')

function themeColor(scheme: 'light' | 'dark') {
  return page
    .querySelector(`meta[name="theme-color"][media="(prefers-color-scheme: ${scheme})"]`)
    ?.getAttribute('content')
}

describe('index.html', () => {
  it('문서 제목은 "아낌표"이고 언어는 한국어다', () => {
    expect(page.title).toBe('아낌표')
    expect(page.documentElement.lang).toBe('ko')
  })

  it('화면을 안전 영역까지 넓혀 env(safe-area-inset-*)가 값을 갖게 한다', () => {
    const viewport = page.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? ''
    expect(viewport.split(/,\s*/)).toEqual(['width=device-width', 'initial-scale=1.0', 'viewport-fit=cover'])
  })

  it('브라우저 위쪽 색은 밝은 화면과 어두운 화면 각각 color-bg 값이다', () => {
    expect(themeColor('light')).toBe('#F6F7F8')
    expect(themeColor('dark')).toBe('#0F1214')
    expect(page.querySelectorAll('meta[name="theme-color"]')).toHaveLength(2)
  })

  it('글꼴 파일을 미리 받아, 브라우저를 다시 열어도 받아 둔 글꼴로 처음부터 그린다', () => {
    // font-display: optional은 첫 그리기까지 글꼴이 준비되지 않으면 대체 글꼴로 남는다.
    const preload = page.querySelector('link[rel="preload"][as="font"]')
    const address = /url\("([^"]+)"\)/.exec(readWebFile('src/styles/fonts.css'))?.[1] ?? ''
    expect(webPath(`.${preload?.getAttribute('href')}`)).toBe(webPath(`src/styles/${address}`))
    expect(preload?.getAttribute('type')).toBe('font/woff2')
    expect(preload?.hasAttribute('crossorigin')).toBe(true)
  })

  it('시스템 설정을 따르도록 data-theme을 두지 않는다', () => {
    expect(page.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('인라인 스크립트와 인라인 스타일이 없다 (CSP script-src, style-src self)', () => {
    const inlineScripts = [...page.querySelectorAll('script')].filter((script) => !script.hasAttribute('src'))
    expect(inlineScripts).toEqual([])
    expect(page.querySelectorAll('style, [style]')).toHaveLength(0)
  })

  it('다른 출처의 파일을 불러오지 않는다', () => {
    const addresses = [...page.querySelectorAll('[src], [href]')].map(
      (element) => element.getAttribute('src') ?? element.getAttribute('href') ?? '',
    )
    expect(addresses.filter((address) => /^([a-z]+:)?\/\//i.test(address))).toEqual([])
  })
})
