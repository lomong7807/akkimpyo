import { afterEach, describe, expect, it } from 'vitest'
import { drawAppOnce } from './support/firstRun'

/*
 * 파일의 테스트를 시작하기 전에 앱을 한 번 그리고 버리는 도우미(#363). 버린 뒤에는 파일의 테스트가 보는 것에 흔적이 없어야 한다.
 */

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('앱을 한 번 그리고 버린다', () => {
  it('화면, local·session 저장소, 바꾼 전역, fetch를 그리기 전으로 되돌린다', async () => {
    localStorage.setItem('kept', 'local')
    sessionStorage.setItem('kept', 'session')
    const fetchBefore = globalThis.fetch
    const matchMediaBefore = globalThis.matchMedia
    expect('IntersectionObserver' in globalThis).toBe(false)

    await drawAppOnce()

    expect(document.body.innerHTML).toBe('')
    expect({ ...localStorage }).toEqual({ kept: 'local' })
    expect({ ...sessionStorage }).toEqual({ kept: 'session' })
    expect('IntersectionObserver' in globalThis).toBe(false)
    expect(globalThis.matchMedia).toBe(matchMediaBefore)
    expect(globalThis.fetch).toBe(fetchBefore)
  })
})
