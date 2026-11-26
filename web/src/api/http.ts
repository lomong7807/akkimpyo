import { ApiError, parseProblem } from './apiError'

const BASE_PATH = '/api/v1'
/** 이 시간 안에 응답을 다 받지 못하면 지연으로 본다(화면설계서 00-common 4.3) */
export const TIMEOUT_MS = 15_000

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** JSON으로 보낼 본문 */
  body?: unknown
  /** 더 붙일 헤더. Authorization, Content-Type, 전용 헤더는 이 계층이 정하므로 덮어쓰지 못한다. */
  headers?: Readonly<Record<string, string>>
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
  return (await sendForResponse(path, options)).body
}

/** send와 같고, 성공한 응답의 상태도 준다(만들기의 201과 재전송의 200처럼 상태로 뜻이 갈리는 곳). */
export async function sendForResponse(
  path: `/${string}`,
  options: SendOptions = {},
): Promise<{ status: number; body: unknown }> {
  const { response, text } = await exchange(path, options)
  if (!response.ok) {
    throw ApiError.response(response.status, parseProblem(response.headers.get('Content-Type'), text))
  }
  if (options.successStatus !== undefined && response.status !== options.successStatus) {
    throw ApiError.unreadable(response.status)
  }
  if (text === '') return { status: response.status, body: undefined }
  try {
    return { status: response.status, body: JSON.parse(text) }
  } catch {
    throw ApiError.unreadable(response.status)
  }
}

async function exchange(
  path: `/${string}`,
  { method = 'GET', body, headers: extraHeaders = {}, accessToken, signal, timeoutMs = TIMEOUT_MS, keepalive }: SendOptions,
) {
  if (signal?.aborted) throw ApiError.timeout()

  // 더 붙인 헤더를 먼저 넣어 아래의 헤더가 덮어쓰게 한다
  const headers = new Headers(extraHeaders)
  headers.delete('Authorization')
  headers.delete('X-Akkimpyo-Client')
  if (body !== undefined) headers.set('Content-Type', 'application/json')
  else headers.delete('Content-Type')
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
