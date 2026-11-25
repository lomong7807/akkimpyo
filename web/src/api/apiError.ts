/**
 * 요청이 실패한 까닭. 화면이 문구를 고르는 기준이다.
 * - connection: 서버에 닿지 못했거나 응답을 받다가 끊겼다. 다른 주소로 보내는 응답(3xx)도 여기에 든다
 * - timeout: 정한 시간 안에 응답을 다 받지 못했거나, 다른 탭의 요청을 기다리다 보내지 못했다
 * - server: 서버 오류(5xx)이거나 응답을 읽을 수 없다
 * - rejected: 서버가 요청을 거부했다(4xx). code와 status로 나눈다
 */
export type ApiErrorKind = 'connection' | 'timeout' | 'server' | 'rejected'

/** 입력란 하나의 검증 오류(ADR 002 4절). 개발자가 읽는 message는 화면 문구로 쓰지 않으므로 담지 않는다. */
export interface FieldError {
  field: string
  code: string
}

/** problem+json에서 화면이 쓰는 값(ADR 002 4절) */
export interface Problem {
  code?: string
  requestId?: string
  fieldErrors: FieldError[]
  /** 수정 충돌 때 서버의 최신 자원 */
  current?: unknown
}

/**
 * 요청이 실패하면 던지는 오류.
 * 원래의 예외(cause)와 요청 본문, problem+json이 아닌 응답 본문은 담지 않는다. 토큰과 비밀번호가 오류와 console에
 * 남지 않게 한다. current에는 장부 데이터가 들어가므로 오류 수집을 붙이면 이 필드는 보내지 않는다.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError'
  readonly kind: ApiErrorKind
  readonly status?: number
  readonly code?: string
  readonly requestId?: string
  readonly fieldErrors: FieldError[]
  readonly current?: unknown

  private constructor(kind: ApiErrorKind, status?: number, problem: Problem = { fieldErrors: [] }) {
    super(['API 요청 실패', kind, status, problem.code].filter((part) => part !== undefined).join(' '))
    this.kind = kind
    this.status = status
    this.code = problem.code
    this.requestId = problem.requestId
    this.fieldErrors = problem.fieldErrors
    this.current = problem.current
  }

  static connection(): ApiError {
    return new ApiError('connection')
  }

  static timeout(): ApiError {
    return new ApiError('timeout')
  }

  /** 성공 상태인데 본문이 약속과 다르다 */
  static unreadable(status?: number): ApiError {
    return new ApiError('server', status)
  }

  static response(status: number, problem?: Problem): ApiError {
    return new ApiError(status >= 400 && status < 500 ? 'rejected' : 'server', status, problem)
  }
}

/** problem+json 본문을 읽는다. 읽을 수 없으면 없는 것으로 보고 상태 코드로 처리하게 한다. */
export function parseProblem(contentType: string | null, text: string): Problem | undefined {
  if (!contentType?.startsWith('application/problem+json')) return undefined
  const body = parseObject(text)
  if (!body) return undefined
  return {
    code: stringOrNone(body.code),
    requestId: stringOrNone(body.requestId),
    fieldErrors: Array.isArray(body.fieldErrors) ? body.fieldErrors.flatMap(toFieldError) : [],
    current: body.current,
  }
}

function toFieldError(item: unknown): FieldError[] {
  if (!isObject(item) || typeof item.field !== 'string' || typeof item.code !== 'string') return []
  return [{ field: item.field, code: item.code }]
}

function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text)
    return isObject(value) ? value : undefined
  } catch {
    return undefined
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stringOrNone(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
