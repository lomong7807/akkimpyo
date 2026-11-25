import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetReturnAddress, readReturnAddress, rememberReturnAddress } from '../src/app/returnAddress'

const KEY = 'akkimpyo-return-address'

/** 주소창의 주소를 브라우저가 나눈 것처럼 경로와 쿼리로 나눈다. */
function remember(address: string) {
  const [pathname, query] = address.split('?')
  rememberReturnAddress({ pathname, search: query === undefined ? '' : `?${query}` })
}

beforeEach(() => sessionStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('이 앱의 로그인이 필요한 주소', () => {
  it.each([
    '/home',
    '/transactions?month=2026-11',
    '/transactions/7/edit',
    '/stats/categories?month=2026-11&type=expense&category=0b9f6c1e',
    '/accounts/1?next=https://evil.example/',
    '/login-help',
    '/settings/login',
    '/',
  ])('%s를 기억했다가 돌려준다', (address) => {
    remember(address)
    expect(readReturnAddress()).toBe(address)
  })

  it('한글 주소는 브라우저가 쓰는 모양으로 돌려준다', () => {
    remember('/없는 주소?달=11월')
    expect(decodeURI(readReturnAddress())).toBe('/없는 주소?달=11월')
  })

  it('마지막에 기억한 주소 하나만 남는다', () => {
    remember('/home')
    remember('/accounts')
    expect(readReturnAddress()).toBe('/accounts')
    expect(sessionStorage.length).toBe(1)
  })

  it('이 창의 저장소에 경로와 쿼리만 남긴다', () => {
    rememberReturnAddress({ pathname: '/trash', search: '?month=2026-11', hash: '#secret' } as never)
    expect({ ...sessionStorage }).toEqual({ [KEY]: '/trash?month=2026-11' })
    expect(localStorage.length).toBe(0)
  })

  it('읽어도 남아 있고, 지우면 없다', () => {
    remember('/trash')
    readReturnAddress()
    expect(readReturnAddress()).toBe('/trash')
    forgetReturnAddress()
    expect(sessionStorage.length).toBe(0)
    expect(readReturnAddress()).toBe('/home')
  })
})

it('기억한 주소가 없으면 /home이다', () => {
  expect(readReturnAddress()).toBe('/home')
})

describe.each([
  ['다른 출처', 'https://evil.example/'],
  ['다른 출처(경로처럼 시작)', '//evil.example/'],
  ['다른 출처(역슬래시)', '/\\evil.example/'],
  ['다른 출처(역슬래시 둘)', '\\\\evil.example/'],
  ['다른 출처(탭)', '/\t/evil.example/'],
  ['다른 출처(줄바꿈)', '/\n/evil.example/'],
  ['다른 출처(탭과 역슬래시)', '/\t\\evil.example/'],
  ['다른 출처(..을 풀면 나오는 것)', '/..//evil.example/'],
  ['다른 출처(.을 풀면 나오는 것)', '/.//evil.example/'],
  ['다른 출처(안쪽 ..을 풀면 나오는 것)', '/home/..//evil.example/'],
  ['읽을 수 없는 주소', '/\t/:80'],
  ['스크립트', 'javascript:alert(1)'],
  ['/로 시작하지 않는 주소', 'home'],
  ['앞에 공백이 있는 주소', ' /home'],
  ['빈 글자', ''],
  ['로그인', '/login'],
  ['로그인과 쿼리', '/login?month=2026-11'],
  ['로그인 뒤의 /', '/login/'],
  ['대문자 로그인', '/LOGIN'],
  ['..을 풀면 로그인', '/home/../login'],
  ['가입', '/signup'],
  ['가입 뒤의 /', '/signup/'],
])('돌아가지 않는 주소: %s', (_, address) => {
  it('저장할 때 버린다', () => {
    rememberReturnAddress({ pathname: address, search: '' })
    expect(sessionStorage.length).toBe(0)
  })

  it('앞서 기억한 주소도 남기지 않는다', () => {
    remember('/accounts')
    rememberReturnAddress({ pathname: address, search: '' })
    expect(readReturnAddress()).toBe('/home')
  })

  it('저장소에 들어 있어도 꺼낼 때 버리고 /home으로 간다', () => {
    sessionStorage.setItem(KEY, address)
    expect(readReturnAddress()).toBe('/home')
  })
})

describe('저장소가 막힌 브라우저', () => {
  const blocked = () => {
    throw new DOMException('막힘', 'SecurityError')
  }

  it('저장소를 여는 것이 막혀도 예외 없이 /home으로 간다', () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(blocked)
    expect(() => remember('/trash')).not.toThrow()
    expect(readReturnAddress()).toBe('/home')
    expect(forgetReturnAddress).not.toThrow()
  })

  it.each(['setItem', 'getItem', 'removeItem'] as const)('%s가 막혀도 예외가 나지 않는다', (method) => {
    vi.spyOn(Storage.prototype, method).mockImplementation(blocked)
    expect(() => remember('/trash')).not.toThrow()
    expect(() => remember('/login')).not.toThrow()
    expect(readReturnAddress).not.toThrow()
    expect(forgetReturnAddress).not.toThrow()
  })
})
