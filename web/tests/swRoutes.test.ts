// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { routeOf } from '../src/sw/swRoutes'

/*
 * service worker가 요청을 어떻게 다룰지(F-120, #234 C, 설계 8.2). API와 운영 확인 경로는 가로채지 않고 캐시에 넣지 않는다
 * (security 검토 항목 3). 화면 이동은 앱 껍데기, 미리 캐시한 파일은 캐시 먼저, 그 밖은 가로채지 않는다.
 */

const ORIGIN = 'https://akkimpyo.example'
const PRECACHED = new Set(['/index.html', '/assets/index-abc.js', '/assets/index-abc.css', '/manifest.webmanifest'])

const route = (url: string, { method = 'GET', mode = 'cors' }: { method?: string; mode?: string } = {}) =>
  routeOf({ url: new URL(url, ORIGIN).href, method, mode }, ORIGIN, PRECACHED)

describe('API와 운영 확인 경로는 가로채지 않는다', () => {
  it.each([
    '/api/v1/me',
    '/api/v1/ledgers/l1/transactions?month=2026-11',
    '/api/v1/',
    '/api',
    '/actuator/health',
    '/actuator',
  ])('%s', (path) => {
    expect(route(path)).toBe('network')
    expect(route(path, { mode: 'navigate' })).toBe('network')
  })

  it('이름이 /api로 시작할 뿐인 화면 주소는 API가 아니다', () => {
    expect(route('/apiary', { mode: 'navigate' })).toBe('shell')
  })
})

describe('화면 이동', () => {
  it.each(['/', '/home', '/transactions/new', '/transactions?month=2026-11', '/login'])('%s는 앱 껍데기다', (path) => {
    expect(route(path, { mode: 'navigate' })).toBe('shell')
  })

  it('파일 이름으로 가는 이동은 껍데기를 주지 않는다(미리 캐시한 것이면 그 파일)', () => {
    expect(route('/sw.js', { mode: 'navigate' })).toBe('network')
    expect(route('/icons/icon-512.png', { mode: 'navigate' })).toBe('network')
    expect(route('/manifest.webmanifest', { mode: 'navigate' })).toBe('precached')
  })
})

describe('파일', () => {
  it('미리 캐시한 파일은 캐시 먼저다', () => {
    expect(route('/assets/index-abc.js')).toBe('precached')
    expect(route('/index.html')).toBe('precached')
  })

  it('미리 캐시하지 않은 파일과 질의가 붙은 주소는 가로채지 않는다', () => {
    expect(route('/assets/other.js')).toBe('network')
    expect(route('/assets/index-abc.js?v=2')).toBe('network')
    expect(route('/sw.js')).toBe('network')
  })
})

describe('가로채지 않는 요청', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])('GET이 아닌 %s', (method) => {
    expect(route('/assets/index-abc.js', { method })).toBe('network')
    expect(route('/home', { method, mode: 'navigate' })).toBe('network')
  })

  it('다른 출처', () => {
    expect(route('https://other.example/assets/index-abc.js')).toBe('network')
    expect(route('https://other.example/home', { mode: 'navigate' })).toBe('network')
  })
})
