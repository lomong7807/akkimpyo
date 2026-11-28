import { exchange, failureOf, type RequestOptions, type SendOptions } from './http'
import { withAccessToken, type SenderCheck } from './session'

/*
 * 파일로 받는 요청(내보내기 #240). 보내는 길은 http.ts의 send와 같고 본문만 글자가 아닌 바이트로 받는다. 쓰는 화면의 조각에만
 * 들도록 http.ts와 나눠 둔다(첫 화면 JS, #355).
 */

/** 파일로 받은 성공 응답 */
export interface FileResponse {
  status: number
  /** 받은 본문. 204처럼 본문이 없는 응답이면 없다 */
  file: Blob | undefined
  /** Content-Disposition 헤더 그대로. 없으면 null */
  disposition: string | null
}

/** 성공이면 바이트, 실패면 problem+json을 읽을 글자 */
type Received = { ok: true; file: Blob } | { ok: false; text: string }

/**
 * send와 같고, 성공한 응답의 본문을 글자로 읽지 않고 바이트 그대로 Blob으로 준다. 실패한 응답은 send와 같이 problem+json을
 * 읽어 ApiError로 던진다. 지연(15초)은 본문을 다 받을 때까지다.
 */
export async function sendForFile(path: `/${string}`, options: SendOptions = {}): Promise<FileResponse> {
  const { response, body } = await exchange(path, options, async (received): Promise<Received> =>
    received.ok ? { ok: true, file: await received.blob() } : { ok: false, text: await received.text() },
  )
  if (!body.ok) throw failureOf(response, body.text)
  const empty = response.status === 204 || response.status === 205
  return {
    status: response.status,
    file: empty ? undefined : body.file,
    disposition: empty ? null : response.headers.get('Content-Disposition'),
  }
}

/**
 * request(api/request)와 같이 로그인한 사용자로 보내고, 성공한 응답을 파일로 준다. 만료된 토큰은 갱신한 뒤 같은 사용자일 때만
 * 한 번 다시 보낸다. `sender`를 주면 보내기 직전마다 토큰의 사용자가 `startedBy`와 같은지 본다(security #79 권고 A).
 */
export function requestFile(
  path: `/${string}`,
  options: RequestOptions = {},
  sender?: SenderCheck,
): Promise<FileResponse> {
  return withAccessToken((accessToken) => sendForFile(path, { ...options, accessToken }), sender)
}
