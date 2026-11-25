import { ApiError, parseProblem } from './apiError'

const BASE_PATH = '/api/v1'
/** 이 시간 안에 응답을 다 받지 못하면 지연으로 본다(화면설계서 00-common 4.3) */
const TIMEOUT_MS = 15_000

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** JSON으로 보낼 본문 */
  body?: unknown
}

interface SendOptions extends RequestOptions {
  accessToken?: string
}

/** /api/v1 아래로 요청을 한 번 보낸다. 앱에서 fetch를 부르는 곳은 여기뿐이다. 실패하면 ApiError를 던진다. */
export async function send(path: `/${string}`, options: SendOptions = {}): Promise<unknown> {
  const { response, text } = await exchange(path, options)
  if (!response.ok) {
    throw ApiError.response(response.status, parseProblem(response.headers.get('Content-Type'), text))
  }
  if (text === '') return undefined
  try {
    return JSON.parse(text)
  } catch {
    throw ApiError.unreadable(response.status)
  }
}

async function exchange(path: `/${string}`, { method = 'GET', body, accessToken }: SendOptions) {
  const headers = new Headers()
  if (body !== undefined) headers.set('Content-Type', 'application/json')
  if (accessToken !== undefined) headers.set('Authorization', `Bearer ${accessToken}`)
  // 다른 출처의 요청을 막는 전용 헤더(ADR 001 결정 5)
  if (path.startsWith('/auth/')) headers.set('X-Akkimpyo-Client', 'web')
  const json = body === undefined ? undefined : JSON.stringify(body)

  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(BASE_PATH + path, { method, headers, body: json, signal: timeout.signal })
    return { response, text: await response.text() }
  } catch {
    throw timeout.signal.aborted ? ApiError.timeout() : ApiError.connection()
  } finally {
    clearTimeout(timer)
  }
}
