// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { cacheNameOf, precacheOf } from '../plugins/serviceWorkerPlugin'

/*
 * service worker를 묶는 빌드 플러그인(설계 8.2). 빌드 결과의 파일 목록을 미리 캐시 목록으로 넣고, 그 파일들의 내용으로
 * 캐시 이름을 정한다. 내용이 바뀌면 sw.js의 글자가 바뀌어 브라우저가 새 판을 설치한다.
 */

const encode = (text: string) => new TextEncoder().encode(text)

describe('미리 캐시 목록', () => {
  it('빌드 결과의 모든 파일을 / 아래 주소로, 정렬해 넣는다', () => {
    expect(precacheOf(['index.html', 'assets/index-abc.js', 'icons/icon-192.png', 'manifest.webmanifest'])).toEqual([
      '/assets/index-abc.js',
      '/icons/icon-192.png',
      '/index.html',
      '/manifest.webmanifest',
    ])
  })

  it('service worker 파일(sw.js, 긴급히 끄는 sw-off.js)과 소스 맵은 넣지 않는다', () => {
    expect(precacheOf(['index.html', 'sw.js', 'sw-off.js', 'assets/index-abc.js.map'])).toEqual(['/index.html'])
  })

  it('윈도의 경로 구분자도 /로 바꾼다', () => {
    expect(precacheOf(['assets\\index-abc.js'])).toEqual(['/assets/index-abc.js'])
  })
})

describe('캐시 이름', () => {
  const files = [
    { path: '/index.html', content: encode('<html>') },
    { path: '/assets/index-abc.js', content: encode('app') },
  ]

  it('akkimpyo-app- 뒤에 내용의 해시를 붙인다', () => {
    expect(cacheNameOf(files)).toMatch(/^akkimpyo-app-[0-9a-f]{16}$/)
  })

  it('같은 내용이면 같고, 파일 하나의 내용이 바뀌거나 이름이 바뀌면 달라진다', () => {
    const name = cacheNameOf(files)
    expect(cacheNameOf([...files].reverse())).toBe(name)
    expect(cacheNameOf([files[0], { ...files[1], content: encode('app2') }])).not.toBe(name)
    expect(cacheNameOf([files[0], { ...files[1], path: '/assets/index-abd.js' }])).not.toBe(name)
  })

  it('경로와 내용의 경계를 섞지 않는다', () => {
    expect(cacheNameOf([{ path: '/a', content: encode('bc') }])).not.toBe(cacheNameOf([{ path: '/ab', content: encode('c') }]))
  })
})
