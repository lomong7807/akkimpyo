import { send, sendForResponse, type RequestOptions } from './http'
import { withAccessToken } from './session'

/** 로그인한 사용자의 API를 부른다. 화면의 훅은 이 함수만 쓴다. 실패하면 ApiError를 던진다. */
export function request<T>(path: `/${string}`, options: RequestOptions = {}): Promise<T> {
  return withAccessToken((accessToken) => send(path, { ...options, accessToken }) as Promise<T>)
}

/** request와 같고, 성공한 응답의 상태도 준다. */
export function requestForResponse<T>(
  path: `/${string}`,
  options: RequestOptions = {},
): Promise<{ status: number; body: T }> {
  return withAccessToken(
    (accessToken) => sendForResponse(path, { ...options, accessToken }) as Promise<{ status: number; body: T }>,
  )
}
