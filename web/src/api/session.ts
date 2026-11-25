import { ApiError } from './apiError'
import { requestLogin, requestRefresh, type Credentials } from './authApi'
import { withSessionLock } from './sessionLock'
import { isSameUser } from './tokenUser'

/** access token은 이 변수에만 둔다(ADR 001 결정 1). 이 모듈 밖에는 요청을 보낼 때만 넘긴다. */
let accessToken: string | undefined

/** 진행 중인 갱신. 한 탭 안에서 갱신을 하나로 묶는다. */
let renewal: Promise<string | undefined> | undefined

const endedListeners = new Set<() => void>()

/** 실패하면 ApiError를 던진다. */
export async function login(credentials: Credentials): Promise<void> {
  await withSessionLock('steal', async (lost) => {
    const token = await requestLogin(credentials, lost)
    if (!lost.aborted) accessToken = token
  })
}

/**
 * 새로고침으로 메모리를 잃은 뒤 refresh 쿠키로 로그인 상태를 되찾는다.
 * 로그인했으면 true, 로그인이 필요하면 false다. 서버에 확인하지 못했으면 ApiError를 던진다.
 */
export async function restoreSession(): Promise<boolean> {
  return (await renew(undefined)) !== undefined
}

/** 이 탭에서 쓰던 로그인이 풀리면 부른다. 돌려받은 함수로 끊는다. */
export function onSessionEnded(listener: () => void): () => void {
  endedListeners.add(listener)
  return () => {
    endedListeners.delete(listener)
  }
}

/**
 * 지금 access token으로 보내고, 만료됐으면 갱신을 한 번 한 뒤 같은 요청을 다시 보낸다(ADR 001 결정 6).
 *
 * refresh 쿠키는 브라우저의 모든 탭이 함께 쓴다. 다른 탭에서 다른 계정으로 로그인하면 갱신이 그 계정의 토큰을 준다.
 * 앞 사용자의 요청을 다른 사용자로 보내지 않도록, 토큰의 사용자가 같을 때만 다시 보낸다.
 * 토큰 없이 보낸 요청은 누구의 것인지 알 수 없으므로 갱신하지 않는다.
 */
export async function withAccessToken<T>(sendWith: (accessToken: string | undefined) => Promise<T>): Promise<T> {
  const used = accessToken
  try {
    return await sendWith(used)
  } catch (error) {
    if (used === undefined || !isUnauthenticated(error)) throw error
    const renewed = await renew(used)
    if (renewed === undefined || !isSameUser(used, renewed)) throw error
    return sendWith(renewed)
  }
}

/** `stale` 다음의 access token. 로그인이 필요하면 없다. 그사이 토큰이 바뀌었으면 갱신하지 않고 그것을 준다. */
function renew(stale: string | undefined): Promise<string | undefined> {
  if (accessToken !== stale) return Promise.resolve(accessToken)
  renewal ??= withSessionLock('fail', async (lost) =>
    accessToken === stale ? refresh(stale, lost) : accessToken,
  ).finally(() => {
    renewal = undefined
  })
  return renewal
}

/**
 * 늦게 온 응답은 버리고 지금 토큰을 준다. 잠금을 빼앗겼거나, 잠금 없이 보내는 동안 이 탭에서 로그인해 토큰이
 * `stale`에서 바뀐 때다.
 */
async function refresh(stale: string | undefined, lost: AbortSignal): Promise<string | undefined> {
  const isCurrent = () => !lost.aborted && accessToken === stale
  try {
    const renewed = await requestRefresh(lost)
    if (isCurrent()) acceptRenewed(renewed)
  } catch (error) {
    // 연결 문제와 서버 오류는 로그인 풀림이 아니다
    if (!(error instanceof ApiError && error.status === 401)) throw error
    if (isCurrent()) endSession()
  }
  return accessToken
}

/** 쓰던 토큰과 사용자가 다르면 이 탭의 로그인은 끝난 것이다. 새 토큰을 두지 않는다. */
function acceptRenewed(renewed: string) {
  if (accessToken !== undefined && !isSameUser(accessToken, renewed)) endSession()
  else accessToken = renewed
}

function endSession() {
  const wasSignedIn = accessToken !== undefined
  accessToken = undefined
  if (wasSignedIn) endedListeners.forEach((notify) => notify())
}

function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401 && error.code === 'UNAUTHENTICATED'
}
