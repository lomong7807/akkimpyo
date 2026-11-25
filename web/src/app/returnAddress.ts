import { matchPath, type Path } from 'react-router'

const KEY = 'akkimpyo-return-address'
const HOME = '/home'

/** 로그인하지 않은 사람의 화면. 로그인한 뒤에 돌아갈 곳이 아니다. */
const signedOutPaths = ['/login', '/signup']

/** 로그인한 뒤 돌아갈 주소를 이 창에만 기억한다(F-011). 경로와 쿼리 말고는 남기지 않는다. */
export function rememberReturnAddress({ pathname, search }: Pick<Path, 'pathname' | 'search'>): void {
  const address = returnable(pathname + search)
  withStorage((storage) => (address === undefined ? storage.removeItem(KEY) : storage.setItem(KEY, address)))
}

/** 로그인한 뒤 갈 주소. 기억한 것이 없으면 홈이다. */
export function readReturnAddress(): string {
  const stored = withStorage((storage) => storage.getItem(KEY))
  return (stored && returnable(stored)) || HOME
}

export function forgetReturnAddress(): void {
  withStorage((storage) => storage.removeItem(KEY))
}

/**
 * 돌아가도 되는 주소면 브라우저가 쓰는 모양으로 준다. 이 앱 밖으로 나가는 주소와 로그인 앞의 화면은 버린다.
 * 저장소의 값은 바뀌었을 수 있으므로 저장할 때와 꺼낼 때 모두 부른다.
 */
function returnable(address: string): string | undefined {
  const url = innerUrl(address)
  // 브라우저가 ..을 풀고 나서 //로 시작하게 되는 주소도 있다
  if (!url || !innerUrl(url.pathname)) return undefined
  if (signedOutPaths.some((path) => matchPath(path, url.pathname))) return undefined
  return url.pathname + url.search
}

function innerUrl(address: string): URL | undefined {
  if (!address.startsWith('/') || address.startsWith('//') || address.startsWith('/\\')) return undefined
  try {
    const url = new URL(address, window.location.origin)
    return url.origin === window.location.origin ? url : undefined
  } catch {
    return undefined
  }
}

/** 저장소가 막혀 있으면 기억하지 않을 뿐 로그인은 된다. */
function withStorage<T>(work: (storage: Storage) => T): T | undefined {
  try {
    return work(window.sessionStorage)
  } catch {
    return undefined
  }
}
