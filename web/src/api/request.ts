import { send, sendForResponse, type RequestOptions } from './http'
import { withAccessToken, type SenderCheck } from './session'

export type { SenderCheck } from './session'

/**
 * 로그인한 사용자의 API를 부른다. 화면의 훅은 이 함수만 쓴다. 실패하면 ApiError를 던진다.
 * `sender`를 주면 보내기 직전마다 쓸 토큰의 사용자가 `startedBy`와 같은지 보고, 다르면 보내지 않는다(security #79 권고 A).
 */
export function request<T>(path: `/${string}`, options: RequestOptions = {}, sender?: SenderCheck): Promise<T> {
  return withAccessToken((accessToken) => send(path, { ...options, accessToken }) as Promise<T>, sender)
}

/** request와 같고, 성공한 응답의 상태도 준다. */
export function requestForResponse<T>(
  path: `/${string}`,
  options: RequestOptions = {},
  sender?: SenderCheck,
): Promise<{ status: number; body: T }> {
  return withAccessToken(
    (accessToken) => sendForResponse(path, { ...options, accessToken }) as Promise<{ status: number; body: T }>,
    sender,
  )
}
