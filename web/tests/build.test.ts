// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { webPath } from './support/webFile'

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
})
