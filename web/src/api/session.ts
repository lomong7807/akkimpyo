import { ApiError } from './apiError'
import {
  requestLogin,
  requestLogout,
  requestRefresh,
  requestSignup,
  type Credentials,
  type Registration,
} from './authApi'
import { withSessionLock } from './sessionLock'
import { logoutValue, pendingLogout, recordLogout, settleLogout } from './sessionMarks'
import { isSameUser } from './tokenUser'

/** access token은 이 변수에만 둔다(ADR 001 결정 1). 이 모듈 밖에는 요청을 보낼 때만 넘긴다. */
let accessToken: string | undefined

/** 진행 중인 갱신. 한 탭 안에서 갱신을 하나로 묶는다. */
let renewal: Promise<string | undefined> | undefined

/** 진행 중인 로그아웃 다시 보내기 */
let resending: Promise<void> | undefined

/**
 * 이 탭에서 쓰던 로그인이 끝난 까닭
 * - ended: 로그인이 풀렸다
 * - logged-out: 사용자가 로그아웃했다
 */
export type SessionEnd = 'ended' | 'logged-out'

const endedListeners = new Set<(end: SessionEnd) => void>()

/** 실패하면 ApiError를 던진다. */
export function login(credentials: Credentials): Promise<void> {
  return startSession((lost) => requestLogin(credentials, lost))
}

/** 가입하고 그 사용자로 로그인한 상태가 된다. 실패하면 ApiError를 던진다. */
export function signup(registration: Registration): Promise<void> {
  return startSession((lost) => requestSignup(registration, lost))
}

/** 로그인이나 가입을 보내는 동안 사용자가 로그아웃했으면 받은 토큰을 쓰지 않고 오류로 끝낸다. */
async function startSession(requestToken: (lost: AbortSignal) => Promise<string>): Promise<void> {
  const logoutSeen = logoutValue()
  let accepted = false
  await withSessionLock('steal', async (lost) => {
    const token = await requestToken(lost)
    if (lost.aborted) return
    settleLogout(logoutSeen)
    if (loggedOutSince(logoutSeen)) return
    accessToken = token
    accepted = true
  })
  // 잠금을 놓고 여기에 오기까지 사이에 로그아웃했으면 토큰이 없다
  if (!accepted || accessToken === undefined) throw ApiError.timeout()
}

/** 이 기기에서 로그아웃한다. 서버의 답을 기다리지 않는다. */
export function logout(): void {
  const value = recordLogout()
  endSession('logged-out')
  // 앞 탭이 멈춰 있어도 사용자가 누른 로그아웃은 서버에 닿게 한다
  void sendLogout(value, 'steal')
}

/** 닿지 못한 로그아웃이 있으면 한 번 다시 보낸다. 실패해도 되풀이하지 않는다. */
export function resendLogout(): void {
  const value = pendingLogout()
  if (value === undefined) return
  resending ??= sendLogout(value, 'fail').finally(() => {
    resending = undefined
  })
}

async function sendLogout(value: string, whenStuck: 'fail' | 'steal'): Promise<void> {
  try {
    await withSessionLock(whenStuck, async (lost) => {
      // 기다리는 사이 로그인이 끝났으면 방금 한 로그인을 끝내게 되고, 새 로그아웃이 있으면 그것이 보낸다
      if (pendingLogout() !== value) return
      await requestLogout(lost)
      if (!lost.aborted) settleLogout(value)
    })
  } catch {
    // 대기를 남긴다. 앱을 열 때와 다시 연결될 때 또 보낸다
  }
}

/**
 * 새로고침으로 메모리를 잃은 뒤 refresh 쿠키로 로그인 상태를 되찾는다.
 * 로그인했으면 true, 로그인이 필요하면 false다. 서버에 확인하지 못했으면 ApiError를 던진다.
 */
export async function restoreSession(): Promise<boolean> {
  return (await renew(undefined)) !== undefined
}

/** 이 탭에서 쓰던 로그인이 끝나면 부른다. 돌려받은 함수로 끊는다. */
export function onSessionEnded(listener: (end: SessionEnd) => void): () => void {
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
  renewal ??= renewUnlessLoggedOut(stale).finally(() => {
    renewal = undefined
  })
  return renewal
}

/** 시작한 뒤에 로그아웃이 있었으면 서버의 답과 상관없이 이 탭의 로그인도 끝난 것이다. */
async function renewUnlessLoggedOut(stale: string | undefined): Promise<string | undefined> {
  const logoutSeen = logoutValue()
  const loggedOut = () => loggedOutSince(logoutSeen)
  if (!loggedOut()) {
    try {
      await withSessionLock('fail', async (lost) => {
        if (accessToken === stale && !loggedOut()) await refresh(stale, lost, loggedOut)
      })
    } catch (error) {
      if (!loggedOut()) throw error
    }
  }
  if (accessToken === stale && loggedOut()) endSession('logged-out')
  return accessToken
}

/**
 * 늦게 온 응답은 버린다. 잠금을 빼앗겼거나, 잠금 없이 보내는 동안 이 탭에서 로그인해 토큰이 `stale`에서 바뀌었거나,
 * 로그아웃이 있었을 때다.
 */
async function refresh(stale: string | undefined, lost: AbortSignal, loggedOut: () => boolean): Promise<void> {
  const isCurrent = () => !lost.aborted && accessToken === stale && !loggedOut()
  try {
    const renewed = await requestRefreshTwice(lost, loggedOut)
    if (isCurrent()) acceptRenewed(renewed)
  } catch (error) {
    // 연결 문제와 서버 오류는 로그인 풀림이 아니다
    if (!(error instanceof ApiError && error.status === 401)) throw error
    if (isCurrent()) endSession('ended')
  }
}

/**
 * 답이 없으면 한 번만 더 보낸다. 앞 요청이 서버에서 회전을 마치고 응답만 못 왔다면 쿠키는 옛것이고,
 * 옛 쿠키는 회전 시각부터 10초 안에만 받아들여진다(ADR 001 결정 3). 어떤 답이든 받았으면 다시 보내지 않는다.
 */
async function requestRefreshTwice(lost: AbortSignal, loggedOut: () => boolean): Promise<string> {
  try {
    return await requestRefresh(lost)
  } catch (error) {
    if (loggedOut() || !(error instanceof ApiError && error.kind === 'timeout')) throw error
    return requestRefresh(lost)
  }
}

/** 쓰던 토큰과 사용자가 다르면 이 탭의 로그인은 끝난 것이다. 새 토큰을 두지 않는다. */
function acceptRenewed(renewed: string) {
  if (accessToken !== undefined && !isSameUser(accessToken, renewed)) endSession('ended')
  else accessToken = renewed
}

/** `logoutSeen`을 본 뒤로 로그아웃이 있었거나, 서버에 닿지 않았을 수 있는 로그아웃이 있다. */
function loggedOutSince(logoutSeen: string | undefined): boolean {
  return logoutValue() !== logoutSeen || pendingLogout() !== undefined
}

function endSession(end: SessionEnd) {
  const wasSignedIn = accessToken !== undefined
  accessToken = undefined
  if (wasSignedIn) endedListeners.forEach((notify) => notify(end))
}

function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401 && error.code === 'UNAUTHENTICATED'
}
