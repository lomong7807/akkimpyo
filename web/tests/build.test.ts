// @vitest-environment node
import { build, type Rolldown } from 'vite'
import { describe, expect, it } from 'vitest'
import { webPath } from './support/webFile'

async function builtFiles(): Promise<Map<string, string>> {
  const output = (await build({
    root: webPath('.'),
    logLevel: 'silent',
    build: { write: false },
  })) as Rolldown.RolldownOutput
  return new Map(
    output.output.map((file) => [file.fileName, file.type === 'chunk' ? file.code : file.source.toString()]),
  )
}

describe('배포 빌드', () => {
  it('미리 받는 글꼴과 @font-face가 쓰는 글꼴이 해시가 붙은 같은 파일이다', async () => {
    const files = await builtFiles()
    const css = [...files].find(([name]) => name.endsWith('.css'))?.[1] ?? ''
    const preload = /<link[^>]*rel="preload"[^>]*>/.exec(files.get('index.html') ?? '')?.[0] ?? ''
    const preloaded = /href="([^"]+)"/.exec(preload)?.[1]
    const fontFace = /@font-face\s*{[^}]*url\("?([^")]+)"?\)/.exec(css)?.[1]

    expect(preloaded).toMatch(/^\/assets\/PretendardVariable-[\w-]+\.woff2$/)
    expect(fontFace).toBe(preloaded)
    expect([...files.keys()]).toContain(preloaded?.slice(1))
  })
})
