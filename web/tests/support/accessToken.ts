function encode(value: object): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

/** 서버가 줄 JWT 모양의 access token. 어느 토큰인지 알아보도록 서명 자리에 이름을 적는다. */
export function accessTokenNamed(name: string, payload: object = { sub: 'user-1' }): string {
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.${name}`
}

/** Authorization 헤더에 실린 토큰의 이름 */
export function tokenNameIn(authorization: string | null): string | null {
  return authorization && authorization.replace('Bearer ', '').split('.').at(-1)!
}
