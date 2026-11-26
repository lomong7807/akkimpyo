import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { build, type Plugin, type ResolvedConfig } from 'vite'
import { CACHE_PREFIX } from '../src/sw/swRoutes'

/*
 * service worker를 묶는 빌드 플러그인(F-120, #234 C, 설계 8.1·8.2). 새 의존성 없이 Vite의 build로 묶는다.
 * 앱 빌드가 끝난 뒤 dist의 파일 목록(index.html, assets/, manifest.webmanifest, icons/)을 미리 캐시 목록으로, 그 내용의
 * 해시를 캐시 이름으로 넣어 src/sw/serviceWorker.ts를 다른 것을 부르지 않는 classic script dist/sw.js(고정 이름)로 낸다.
 * 빌드 결과가 바뀌면 sw.js의 글자가 바뀌어 브라우저가 새 판을 설치한다. 개발 모드(npm run dev)에서는 돌지 않는다.
 * /sw.js의 이름이나 범위를 바꾸면 devops에게 알린다(프록시의 Cache-Control과 Content-Type, devops Q15).
 */

const SW_FILE = 'sw.js'
const ENTRY = 'src/sw/serviceWorker.ts'

/** dist 안의 파일(dist 기준 경로)을 미리 캐시할 주소로. sw.js 자신과 소스 맵은 뺀다. */
export function precacheOf(files: string[]): string[] {
  return files
    .map((file) => file.split('\\').join('/'))
    .filter((file) => file !== SW_FILE && !file.endsWith('.map'))
    .map((file) => `/${file}`)
    .sort()
}

/** 미리 캐시하는 파일들의 주소와 내용으로 정한 캐시 이름. 순서와 무관하고, 경로와 내용의 경계를 섞지 않는다. */
export function cacheNameOf(files: { path: string; content: Uint8Array }[]): string {
  const hash = createHash('sha256')
  for (const { path, content } of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    hash.update(`${path}\0${content.byteLength}\0`)
    hash.update(content)
  }
  return `${CACHE_PREFIX}${hash.digest('hex').slice(0, 16)}`
}

export function serviceWorker(): Plugin {
  let config: ResolvedConfig
  return {
    name: 'akkimpyo-service-worker',
    apply: 'build',
    configResolved(resolved) {
      config = resolved
    },
    async closeBundle() {
      const outDir = resolve(config.root, config.build.outDir)
      const precache = precacheOf(await filesIn(outDir))
      const files = await Promise.all(
        precache.map(async (path) => ({ path, content: await readFile(join(outDir, path.slice(1))) })),
      )
      await build({
        configFile: false,
        root: config.root,
        logLevel: 'warn',
        publicDir: false,
        define: {
          __PRECACHE__: JSON.stringify(precache),
          __CACHE_NAME__: JSON.stringify(cacheNameOf(files)),
        },
        build: {
          outDir,
          emptyOutDir: false,
          copyPublicDir: false,
          minify: true,
          lib: {
            entry: resolve(config.root, ENTRY),
            formats: ['iife'],
            name: 'akkimpyoServiceWorker',
            fileName: () => SW_FILE,
          },
        },
      })
    },
  }
}

async function filesIn(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true })
  return entries.filter((entry) => entry.isFile()).map((entry) => relative(directory, join(entry.parentPath, entry.name)))
}
