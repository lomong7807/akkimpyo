import { ApiError } from './apiError'
import { requestLogin, requestRefresh, type Credentials } from './authApi'
import { withSessionLock } from './sessionLock'

/** access token은 이 변수에만 둔다(ADR 001 결정 1). 이 모듈 밖에는 요청을 보낼 때만 넘긴다. */
let accessToken: string | undefined

/** 진행 중인 갱신. 한 탭 안에서 갱신을 하나로 묶는다. */
let renewal: Promise<string | undefined> | undefined

const endedListeners = new Set<() => void>()

/** 실패하면 ApiError를 던진다. */
export async function login(credentials: Credentials): Promise<void> {
  await withSessionLock(async () => {
    accessToken = await requestLogin(credentials)
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

/** 지금 access token으로 보내고, 만료됐으면 갱신을 한 번 한 뒤 같은 요청을 다시 보낸다(ADR 001 결정 6). */
export async function withAccessToken<T>(sendWith: (accessToken: string | undefined) => Promise<T>): Promise<T> {
  const used = accessToken
  try {
    return await sendWith(used)
  } catch (error) {
    if (!isUnauthenticated(error)) throw error
    const renewed = await renew(used)
    if (renewed === undefined) throw error
    return sendWith(renewed)
  }
}

/** `stale` 다음의 access token. 로그인이 필요하면 없다. 그사이 토큰이 바뀌었으면 갱신하지 않고 그것을 준다. */
function renew(stale: string | undefined): Promise<string | undefined> {
  if (accessToken !== stale) return Promise.resolve(accessToken)
  renewal ??= withSessionLock(async () => (accessToken === stale ? refresh() : accessToken)).finally(() => {
    renewal = undefined
  })
  return renewal
}

async function refresh(): Promise<string | undefined> {
  try {
    accessToken = await requestRefresh()
  } catch (error) {
    // 연결 문제와 서버 오류는 로그인 풀림이 아니다
    if (!(error instanceof ApiError && error.status === 401)) throw error
    endSession()
  }
  return accessToken
}

function endSession() {
  const wasSignedIn = accessToken !== undefined
  accessToken = undefined
  if (wasSignedIn) endedListeners.forEach((notify) => notify())
}

function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401 && error.code === 'UNAUTHENTICATED'
}
