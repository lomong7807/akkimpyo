import { ApiError } from './apiError'
import { send } from './http'

/*
 * 로그인과 갱신의 경로와 필드 이름. ADR과 서버 이슈에 적히지 않은 이름은 이 파일에만 있다.
 * 서버(#12, #26)와 다르면 여기만 고친다.
 */

export interface Credentials {
  email: string
  password: string
}

/** 새 access token을 돌려준다. refresh token은 서버가 HttpOnly 쿠키로 준다. */
export async function requestLogin({ email, password }: Credentials, signal: AbortSignal): Promise<string> {
  return accessTokenIn(await send('/auth/login', { method: 'POST', body: { email, password }, signal }))
}

/** refresh 쿠키로 새 access token을 받는다. */
export async function requestRefresh(signal: AbortSignal): Promise<string> {
  return accessTokenIn(await send('/auth/refresh', { method: 'POST', signal }))
}

/** Authorization 헤더에 넣을 수 있는 글자만 받는다(RFC 6750 2.1절 b64token). */
const bearerToken = /^[\w.~+/-]+=*$/

function accessTokenIn(body: unknown): string {
  const token = (body as { accessToken?: unknown } | null | undefined)?.accessToken
  if (typeof token !== 'string' || !bearerToken.test(token)) throw ApiError.unreadable()
  return token
}
