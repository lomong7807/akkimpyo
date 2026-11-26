/**
 * 두 access token이 같은 사용자의 것인지 본다.
 * 서명을 확인하지 않으므로 권한 판단에 쓰지 않는다. 어느 쪽이든 사용자를 읽지 못하면 다른 것으로 본다.
 */
export function isSameUser(token: string, other: string): boolean {
  const user = userOf(token)
  return user !== undefined && user === userOf(other)
}

/** JWT의 sub(ADR 001 결정 1). 서명을 확인하지 않은 값이다. 읽지 못하면 없다. */
export function userOf(token: string): string | undefined {
  const parts = token.split('.')
  if (parts.length !== 3) return undefined
  try {
    const payload = JSON.parse(atob(parts[1].replaceAll('-', '+').replaceAll('_', '/'))) as { sub?: unknown } | null
    const sub = payload?.sub
    return typeof sub === 'string' && sub !== '' ? sub : undefined
  } catch {
    return undefined
  }
}
