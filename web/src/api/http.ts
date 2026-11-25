import { ApiError, parseProblem } from './apiError'

const BASE_PATH = '/api/v1'
/** 이 시간 안에 응답을 다 받지 못하면 지연으로 본다(화면설계서 00-common 4.3) */
export const TIMEOUT_MS = 15_000

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** JSON으로 보낼 본문 */
  body?: unknown
}

export interface SendOptions extends RequestOptions {
  accessToken?: string
  /** 중단되면 응답을 기다리지 않고 지연 오류로 끝낸다 */
  signal?: AbortSignal
  timeoutMs?: number
  /** 이 상태만 성공으로 본다. 없으면 2xx가 모두 성공이다. */
  successStatus?: number
  /** 보내고 바로 탭을 닫아도 요청이 끝까지 나간다. */
  keepalive?: boolean
}

/** /api/v1 아래로 요청을 한 번 보낸다. 앱에서 fetch를 부르는 곳은 여기뿐이다. 실패하면 ApiError를 던진다. */
export async function send(path: `/${string}`, options: SendOptions = {}): Promise<unknown> {
  const { response, text } = await exchange(path, options)
  if (!response.ok) {
    throw ApiError.response(response.status, parseProblem(response.headers.get('Content-Type'), text))
  }
  if (options.successStatus !== undefined && response.status !== options.successStatus) {
    throw ApiError.unreadable(response.status)
  }
  if (text === '') return undefined
  try {
    return JSON.parse(text)
  } catch {
    throw ApiError.unreadable(response.status)
  }
}

async function exchange(
  path: `/${string}`,
  { method = 'GET', body, accessToken, signal, timeoutMs = TIMEOUT_MS, keepalive }: SendOptions,
) {
  if (signal?.aborted) throw ApiError.timeout()

  const headers = new Headers()
  if (body !== undefined) headers.set('Content-Type', 'application/json')
  if (accessToken !== undefined) headers.set('Authorization', `Bearer ${accessToken}`)
  // 다른 출처의 요청을 막는 전용 헤더(ADR 001 결정 5)
  if (path.startsWith('/auth/')) headers.set('X-Akkimpyo-Client', 'web')
  const json = body === undefined ? undefined : JSON.stringify(body)

  const aborter = new AbortController()
  const abort = () => aborter.abort()
  const timer = setTimeout(abort, timeoutMs)
  signal?.addEventListener('abort', abort)
  try {
    const response = await fetch(BASE_PATH + path, {
      method,
      headers,
      body: json,
      signal: aborter.signal,
      // API는 다른 주소로 보내지 않는다. 따라가면 본문과 토큰이 다른 곳으로 갈 수 있다
      redirect: 'error',
      // 브라우저의 HTTP 캐시가 앞 사용자의 응답을 주지 않게 한다
      cache: 'no-store',
      keepalive,
    })
    return { response, text: await response.text() }
  } catch {
    throw aborter.signal.aborted ? ApiError.timeout() : ApiError.connection()
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}
