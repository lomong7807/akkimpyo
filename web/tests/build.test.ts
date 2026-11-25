// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readWebFile, webPath } from './support/webFile'

// 주소가 깊은 화면에서도 같은 파일을 가리키는지 보려고 깊은 주소를 기준으로 삼는다.
const page = 'https://akkimpyo.test/transactions/1/edit'
let outDir = ''

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'akkimpyo-web-build-'))
  // public/의 파일은 실제로 쓸 때만 빌드 결과에 들어간다.
  await build({ root: webPath('.'), logLevel: 'silent', build: { outDir, emptyOutDir: true } })
})

afterAll(() => rmSync(outDir, { recursive: true, force: true }))

/** 화면에서 이 주소로 받게 될 빌드 결과 파일. */
function builtFile(address: string, base: string = page): Buffer {
  return readFileSync(join(outDir, new URL(address, base).pathname))
}

/** 빌드된 index.html의 `<link>` 가운데 rel이 같은 것의 속성. */
function links(rel: string): Record<string, string>[] {
  const html = builtFile('/index.html').toString()
  return [...html.matchAll(/<link\b([^>]*)>/g)]
    .map(([, attributes]) => [...attributes.matchAll(/([\w-]+)="([^"]*)"/g)])
    .map((attributes) => Object.fromEntries(attributes.map(([, name, value]) => [name, value])))
    .filter((link) => link.rel === rel)
}

/** PNG 머리에 적힌 "가로x세로". PNG가 아니면 실패한다. */
function pngSize(file: Buffer): string {
  expect(file.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  return `${file.readUInt32BE(16)}x${file.readUInt32BE(20)}`
}

describe('배포 빌드', () => {
  it('미리 받는 글꼴과 @font-face가 쓰는 글꼴이 해시가 붙은 같은 파일이다', () => {
    const css = links('stylesheet')
      .map((link) => builtFile(link.href).toString())
      .join('')
    const preloaded = links('preload').find((link) => link.as === 'font')?.href ?? ''
    const fontFace = /@font-face\s*{[^}]*url\("?([^")]+)"?\)/.exec(css)?.[1]

    expect(preloaded).toMatch(/^\/assets\/PretendardVariable-[\w-]+\.woff2$/)
    expect(fontFace).toBe(preloaded)
    expect(builtFile(preloaded).subarray(0, 4).toString()).toBe('wOF2')
  })
})

describe('홈 화면 설치 (F-120)', () => {
  type Icon = { src: string; sizes: string; type: string; purpose: string }

  function manifestAddress(): string {
    const found = links('manifest')
    expect(found).toHaveLength(1)
    return new URL(found[0].href, page).href
  }

  function manifest() {
    return JSON.parse(builtFile(manifestAddress()).toString()) as Record<string, unknown> & { icons: Icon[] }
  }

  it('매니페스트의 이름은 "아낌표"이고 /home에서 독립 창으로 연다', () => {
    expect(manifest()).toMatchObject({
      name: '아낌표',
      short_name: '아낌표',
      lang: 'ko',
      // 시작 주소가 바뀌어도 이미 설치한 앱과 같은 앱으로 이어지게 하는 값이라 바꾸지 않는다.
      id: '/home',
      start_url: '/home',
      scope: '/',
      display: 'standalone',
    })
  })

  it('매니페스트의 배경색과 테마 색은 color-bg의 밝은 값이다', () => {
    const colorBg = /^:root\s*{[^}]*--color-bg:\s*([^;]+);/m.exec(readWebFile('src/styles/tokens.css'))?.[1]
    expect(colorBg).toMatch(/^#[0-9A-F]{6}$/)
    expect(manifest()).toMatchObject({ background_color: colorBg, theme_color: colorBg })
  })

  it('매니페스트의 192와 512 아이콘은 같은 파일을 any와 maskable 두 용도로 쓴다', () => {
    const { icons } = manifest()
    const purposes = ['any', 'maskable']
    expect(icons.map((icon) => `${icon.sizes} ${icon.purpose}`).sort()).toEqual(
      ['192x192', '512x512'].flatMap((size) => purposes.map((purpose) => `${size} ${purpose}`)),
    )
    expect(new Set(icons.map((icon) => icon.src)).size).toBe(2)
  })

  it('매니페스트의 아이콘 주소는 빌드 결과의 PNG를 가리키고 크기가 적힌 값과 같다', () => {
    const { icons } = manifest()
    expect(icons).not.toHaveLength(0)
    for (const icon of icons) {
      expect(icon.type).toBe('image/png')
      expect(pngSize(builtFile(icon.src, manifestAddress())), icon.src).toBe(icon.sizes)
    }
  })

  it('iPhone 홈 화면 아이콘은 180x180 PNG다', () => {
    const [icon, ...others] = links('apple-touch-icon')
    expect(others).toEqual([])
    expect(icon?.sizes).toBe('180x180')
    expect(pngSize(builtFile(icon.href))).toBe('180x180')
  })

  it('파비콘은 32x32와 16x16 PNG다', () => {
    const icons = links('icon')
    expect(icons.map((icon) => icon.sizes)).toEqual(['32x32', '16x16'])
    for (const icon of icons) {
      expect(icon.type).toBe('image/png')
      expect(pngSize(builtFile(icon.href)), icon.href).toBe(icon.sizes)
    }
  })

  it('테스트용 가짜 응답(msw)이 들어가지 않는다', async () => {
    const files = await builtFiles()
    const scripts = [...files].filter(([name]) => name.endsWith('.js'))
    expect(scripts).not.toHaveLength(0)
    for (const [name, code] of scripts) {
      expect(name).not.toContain('mockServiceWorker')
      expect(code).not.toMatch(/mockServiceWorker|\[MSW\]/)
    }
  })
})
