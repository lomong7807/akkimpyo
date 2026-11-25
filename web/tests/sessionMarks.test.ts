import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** 128비트의 16진 문자열 */
const RANDOM = /^[0-9a-f]{32}$/

/** 탭 하나. 모듈을 새로 불러와 메모리를 다른 탭과 나누지 않는다. 저장소는 함께 쓴다. */
async function openTab() {
  vi.resetModules()
  return import('../src/api/sessionMarks')
}

/** 저장소의 값을 모두 모은다. */
const stored = () => Object.values({ ...localStorage }) as string[]

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('로그아웃 값과 로그아웃 대기', () => {
  it('로그아웃한 적이 없으면 값도 대기도 없다', async () => {
    const tab = await openTab()
    expect(tab.logoutValue()).toBeUndefined()
    expect(tab.pendingLogout()).toBeUndefined()
  })

  it('로그아웃할 때마다 새 값이 생기고, 그 값이 대기한다', async () => {
    const tab = await openTab()
    const first = tab.recordLogout()
    expect(tab.logoutValue()).toBe(first)
    expect(tab.pendingLogout()).toBe(first)
    const second = tab.recordLogout()
    expect(second).not.toBe(first)
    expect(tab.logoutValue()).toBe(second)
    expect(tab.pendingLogout()).toBe(second)
  })

  it('끝나면 대기는 없어지고 값은 남는다', async () => {
    const tab = await openTab()
    const value = tab.recordLogout()
    tab.settleLogout(value)
    expect(tab.pendingLogout()).toBeUndefined()
    expect(tab.logoutValue()).toBe(value)
  })

  it('앞 로그아웃이 끝나도 뒤 로그아웃의 대기는 없어지지 않는다', async () => {
    const tab = await openTab()
    const first = tab.recordLogout()
    const second = tab.recordLogout()
    tab.settleLogout(first)
    expect(tab.pendingLogout()).toBe(second)
  })

  it('끝난 뒤 다시 로그아웃하면 다시 대기한다', async () => {
    const tab = await openTab()
    tab.settleLogout(tab.recordLogout())
    const again = tab.recordLogout()
    expect(tab.pendingLogout()).toBe(again)
  })

  it('로그아웃한 적이 없을 때 끝낼 것이 없다', async () => {
    const tab = await openTab()
    tab.settleLogout(undefined)
    expect(localStorage.length).toBe(0)
  })

  it('다른 탭과 다시 연 화면도 값과 대기를 안다', async () => {
    const value = (await openTab()).recordLogout()
    const other = await openTab()
    expect(other.logoutValue()).toBe(value)
    expect(other.pendingLogout()).toBe(value)
    other.settleLogout(value)
    expect((await openTab()).pendingLogout()).toBeUndefined()
  })

  it('다른 탭이 대기를 없애는 사이에 한 새 로그아웃의 대기가 남는다', async () => {
    const [tab, other] = [await openTab(), await openTab()]
    const first = tab.recordLogout()
    // 앞 로그아웃을 끝내는 저장이 다른 탭의 새 로그아웃보다 늦게 닿는다
    const write = vi.spyOn(Storage.prototype, 'setItem')
    write.mockImplementationOnce(function (this: Storage, key, value) {
      const second = other.recordLogout()
      write.mockRestore()
      this.setItem(key, value)
      expect(other.pendingLogout()).toBe(second)
    })
    tab.settleLogout(first)
    expect((await openTab()).pendingLogout()).not.toBe(first)
    expect((await openTab()).pendingLogout()).toMatch(RANDOM)
  })
})

describe('로그인 값', () => {
  it('로그인할 때마다 바뀌고 로그아웃 값과 대기에는 영향이 없다', async () => {
    const tab = await openTab()
    const logout = tab.recordLogout()
    const first = tab.recordLogin()
    expect(tab.loginValue()).toBe(first)
    expect(tab.recordLogin()).not.toBe(first)
    expect(tab.logoutValue()).toBe(logout)
    expect(tab.pendingLogout()).toBe(logout)
  })

  it('로그아웃하고 끝나도 바뀌지 않는다', async () => {
    const tab = await openTab()
    const login = tab.recordLogin()
    tab.settleLogout(tab.recordLogout())
    expect(tab.loginValue()).toBe(login)
  })
})

it('저장소에는 뜻이 없는 임의 값만 남는다', async () => {
  const tab = await openTab()
  tab.recordLogin()
  tab.settleLogout(tab.recordLogout())
  tab.recordLogout()
  expect(stored()).not.toHaveLength(0)
  for (const value of stored()) expect(value).toMatch(RANDOM)
  expect(sessionStorage.length).toBe(0)
  expect(document.cookie).toBe('')
})

it('값은 128비트 난수를 빠짐없이 적은 것이라 앞의 0도 남는다', async () => {
  vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
    ;(array as Uint8Array).set([0, 1, 10, 15, 16, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7])
    return array
  })
  expect((await openTab()).recordLogout()).toBe('00010a0f10ff00000000000000000007')
})

describe('저장소를 쓸 수 없으면', () => {
  const blocked = () => {
    throw new DOMException('막힘', 'SecurityError')
  }

  const ways: [string, () => void][] = [
    ['막힘', () => vi.spyOn(window, 'localStorage', 'get').mockImplementation(blocked)],
    ['없음', () => vi.spyOn(window, 'localStorage', 'get').mockReturnValue(null as unknown as Storage)],
    [
      '가득 참',
      () =>
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
          throw new DOMException('가득 참', 'QuotaExceededError')
        }),
    ],
  ]

  it.each(ways)('%s: 이 탭의 메모리에만 두고 계속한다', async (_, block) => {
    block()
    const tab = await openTab()
    const login = tab.recordLogin()
    expect(tab.loginValue()).toBe(login)
    const logout = tab.recordLogout()
    expect(tab.logoutValue()).toBe(logout)
    expect(tab.pendingLogout()).toBe(logout)
    tab.settleLogout(logout)
    expect(tab.pendingLogout()).toBeUndefined()
    expect(tab.logoutValue()).toBe(logout)
  })

  it.each(ways)('%s: 쓴 뒤에는 다른 탭과 나누지 못한 것을 안다', async (_, block) => {
    block()
    const tab = await openTab()
    tab.recordLogin()
    expect(tab.marksShared()).toBe(false)
  })

  it('쓴 적이 없어도 읽지 못하면 나누지 못한다', async () => {
    ways[0][1]()
    expect((await openTab()).marksShared()).toBe(false)
  })

  it('저장하지 못한 값이 있어도, 다시 저장하면 다른 탭이 안다', async () => {
    const full = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('가득 참', 'QuotaExceededError')
    })
    const tab = await openTab()
    tab.recordLogout()
    full.mockRestore()
    const value = tab.recordLogout()
    expect(tab.logoutValue()).toBe(value)
    expect(tab.marksShared()).toBe(true)
    expect((await openTab()).logoutValue()).toBe(value)
  })
})
