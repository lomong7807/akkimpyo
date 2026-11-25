/*
 * 같은 브라우저의 탭과 되살아난 화면이 로그인과 로그아웃을 아는 표시. 뜻이 없는 임의 값만 localStorage에 남긴다.
 * 토큰, 이메일, 사용자 id, 장부 정보는 두지 않는다.
 *
 * 키마다 쓰는 때가 하나씩이다. 한 키에 모으면 다른 탭이 방금 쓴 값을 되돌릴 수 있다.
 */

/** 로그아웃할 때마다 바뀐다. 서버의 답과 상관없이 남아 다른 탭이 로그아웃이 있었음을 안다. */
const LOGOUT = 'akkimpyo-logout'
/**
 * 더 보낼 것이 없는 로그아웃의 값. 로그아웃 값과 다르면 로그아웃 대기다.
 * 대기를 따로 적었다가 지우면, 지우는 사이에 다른 탭이 남긴 새 로그아웃의 대기까지 지울 수 있다.
 */
const DONE = 'akkimpyo-logout-done'
/** 로그인이나 가입을 보낼 때마다 바뀐다. */
const LOGIN = 'akkimpyo-login'

/** 저장소에 쓰지 못한 값. 이 탭에서만 안다. */
const unsaved = new Map<string, string>()

export function logoutValue(): string | undefined {
  return read(LOGOUT)
}

export function loginValue(): string | undefined {
  return read(LOGIN)
}

/** 서버에 닿지 않았을 수 있는 로그아웃의 값 */
export function pendingLogout(): string | undefined {
  const value = read(LOGOUT)
  return value === read(DONE) ? undefined : value
}

/** 새 로그아웃을 대기로 남기고 그 값을 돌려준다. */
export function recordLogout(): string {
  return write(LOGOUT, randomValue())
}

/** `value`의 로그아웃은 더 보낼 것이 없다. 그사이 새 로그아웃이 있었으면 그 대기는 남는다. */
export function settleLogout(value: string | undefined): void {
  if (value !== undefined && read(LOGOUT) === value) write(DONE, value)
}

/** 새 로그인을 남기고 그 값을 돌려준다. */
export function recordLogin(): string {
  return write(LOGIN, randomValue())
}

/** 다른 탭과 표시를 나누고 있는지 */
export function marksShared(): boolean {
  try {
    window.localStorage.getItem(LOGOUT)
    return unsaved.size === 0
  } catch {
    return false
  }
}

/** 128비트 난수. crypto.randomUUID는 https와 localhost에만 있어 LAN 주소로 연 개발 화면에서 쓸 수 없다. */
function randomValue(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function read(key: string): string | undefined {
  if (unsaved.has(key)) return unsaved.get(key)
  try {
    return window.localStorage.getItem(key) ?? undefined
  } catch {
    return undefined
  }
}

function write(key: string, value: string): string {
  try {
    window.localStorage.setItem(key, value)
    unsaved.delete(key)
  } catch {
    unsaved.set(key, value)
  }
  return value
}
