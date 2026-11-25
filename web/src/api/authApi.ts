import { ApiError } from './apiError'
import { send, type SendOptions } from './http'

/*
 * 로그인, 가입, 갱신, 로그아웃의 경로와 필드 이름. ADR과 서버 이슈에 적히지 않은 이름은 이 파일에만 있다.
 * 서버(#12, #26, #28, #29)와 다르면 여기만 고친다.
 */

export interface Credentials {
  email: string
  password: string
}

/** 새 access token을 돌려준다. refresh token은 서버가 HttpOnly 쿠키로 준다. */
export async function requestLogin({ email, password }: Credentials, signal: AbortSignal): Promise<string> {
  return accessTokenIn(await send('/auth/login', { method: 'POST', body: { email, password }, signal }))
}

export interface Registration {
  email: string
  password: string
  displayName: string
}

/** 가입하면 바로 로그인한 상태가 된다. 응답과 쿠키는 로그인과 같다. */
export async function requestSignup(
  { email, password, displayName }: Registration,
  signal: AbortSignal,
): Promise<string> {
  return accessTokenIn(await send('/auth/signup', { method: 'POST', body: { email, password, displayName }, signal }))
}

/** 갱신은 다시 보낸 요청이 서버의 허용 시간 안에 닿도록 짧게 기다린다(session.ts의 requestRefreshTwice). */
const REFRESH_TIMEOUT_MS = 5_000

/** refresh 쿠키로 새 access token을 받는다. */
export async function requestRefresh(signal: AbortSignal): Promise<string> {
  return accessTokenIn(await send('/auth/refresh', { method: 'POST', signal, timeoutMs: REFRESH_TIMEOUT_MS }))
}

/** 닿지 못한 로그아웃은 앱을 열 때와 다시 연결될 때 또 보내므로 짧게 기다린다. */
const LOGOUT_TIMEOUT_MS = 5_000

/** refresh 쿠키가 가리키는 로그인을 서버에서 끝낸다. 서버는 이미 끝난 로그인에도 204로 답하므로 204만 성공이다(#28). */
export async function requestLogout(signal: AbortSignal, { keepalive }: Pick<SendOptions, 'keepalive'>): Promise<void> {
  await send('/auth/logout', { method: 'POST', signal, timeoutMs: LOGOUT_TIMEOUT_MS, successStatus: 204, keepalive })
}

/** Authorization 헤더에 넣을 수 있는 글자만 받는다(RFC 6750 2.1절 b64token). */
const bearerToken = /^[\w.~+/-]+=*$/

function accessTokenIn(body: unknown): string {
  const token = (body as { accessToken?: unknown } | null | undefined)?.accessToken
  if (typeof token !== 'string' || !bearerToken.test(token)) throw ApiError.unreadable()
  return token
}
