import { confirmLogin, forgetLoginRecord, forgetLoginRecordOf, readLoginRecord } from '../device/loginRecord'
import { forgetUserData } from '../device/userData'
import { now } from '../lib/clock'
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
import {
  loginValue,
  logoutValue,
  marksShared,
  pendingLogout,
  recordLogin,
  recordLogout,
  settleLogout,
} from './sessionMarks'
import { isSameUser, userOf } from './tokenUser'
import { unconfirmedUserOf } from './unconfirmedLogin'

const UNAUTHENTICATED = 'UNAUTHENTICATED'

/** access token은 이 변수에만 둔다(ADR 001 결정 1). 이 모듈 밖에는 요청을 보낼 때만 넘긴다. */
let accessToken: string | undefined

/** 로그인이나 되찾기를 시작할 때 본 표시. 바뀌었으면 그 뒤에 로그아웃하거나 로그인했다. */
interface SeenMarks {
  logout: string | undefined
  login: string | undefined
}

/** access token을 준 로그인이나 되찾기의 것 */
let seenMarks: SeenMarks = { logout: undefined, login: undefined }

/**
 * 서버에 확인하지 못한 채 연 로그인(architect·security 결정 2026-11-26, #234). 연결 없이 앱을 열 때 기기의 마지막 로그인
 * 기록으로 연다. 토큰이 없으므로 요청은 먼저 갱신해야 보낸다. `seen`은 연 때의 표시이고 기록의 표시와 같다.
 */
let unconfirmed: { userId: string; seen: SeenMarks } | undefined

/** 화면이 브라우저에 보관돼 있거나 되살아나 아직 확인하지 않았다. */
let suspended = false

/** 진행 중인 갱신. 한 탭 안에서 같은 토큰의 갱신을 하나로 묶는다. */
let renewal: { stale: string | undefined; token: Promise<string | undefined> } | undefined

/** 진행 중인 로그아웃 다시 보내기 */
let resending: Promise<void> | undefined

/**
 * 이 탭에서 쓰던 로그인이 끝난 까닭
 * - ended: 로그인이 풀렸다
 * - logged-out: 사용자가 로그아웃했다(다른 탭 포함)
 * - replaced, replaced-after-logout: 화면이 보관된 동안 로그인했거나(그랬을 수 있거나) 로그아웃했다. 지금 로그인을 다시
 *   확인해야 안다
 */
export type SessionEnd = 'ended' | 'logged-out' | 'replaced' | 'replaced-after-logout'

const endedListeners = new Set<(end: SessionEnd) => void>()
const endingListeners = new Set<(userId: string) => void>()
const confirmedListeners = new Set<() => void>()

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
  const logout = logoutValue()
  let accepted = false
  await withSessionLock('steal', async (lost) => {
    const seen = { logout, login: recordLogin() }
    const token = await requestToken(lost)
    if (lost.aborted) return
    settleLogout(seen.logout)
    if (loggedOutSince(seen)) return
    accessToken = token
    seenMarks = seen
    unconfirmed = undefined
    accepted = true
    keepConfirmedLogin(token, seen, true)
  })
  // 잠금을 놓고 여기에 오기까지 사이에 로그아웃했으면 토큰이 없다
  if (!accepted || accessToken === undefined) throw ApiError.timeout()
}

/**
 * 이 기기에서 로그아웃한다. 서버의 답을 기다리지 않는다.
 * 마지막으로 확인한 로그인 기록을 가장 먼저 지우고, 그 사용자의 기기 데이터(사본, 보내지 않은 입력, 쓰던 값)를 지운다(F-016).
 */
export function logout(): void {
  const user = sessionUserId()
  void forgetLoginRecord().catch(ignore)
  const value = recordLogout()
  endSession('logged-out')
  if (user !== undefined) void forgetUserData(user).catch(ignore)
  void sendLogout(value, 'pressed')
}

/** 닿지 못한 로그아웃이 있으면 한 번 다시 보낸다. 실패해도 되풀이하지 않는다. */
export function resendLogout(): void {
  const value = pendingLogout()
  if (value === undefined) return
  resending ??= sendLogout(value, 'resent').finally(() => {
    resending = undefined
  })
}

/**
 * 다시 보내는 로그아웃이 잠금을 얻은 뒤 표시를 읽기까지 기다리는 시간.
 * localStorage의 값이 다른 프로세스의 탭에 보이는 것과 그 탭이 잠금을 넘겨받는 것은 순서가 정해져 있지 않다. 얻자마자 읽은 값은
 * 150번 중 33번 낡았고 늦어도 약 7ms 뒤에 새 값이 보였다(Chrome 158, 2026-11-26에 잼). 낡은 대기를 보고 보내면 다른 탭이
 * 방금 한 로그인을 끝낸다. 잰 값에 여유를 둔 것이며, 순서가 보장되지 않으므로 완전히 막지는 못한다.
 */
const MARKS_ARRIVE_MS = 100

/**
 * - pressed: 사용자가 눌렀다. 앞 탭이 멈춰 있어도 서버에 닿게 잠금을 빼앗는다. 자기 값이 가장 새것이고 탭을 바로 닫을 수
 *   있으므로 기다리지 않고 보내며, 보낸 뒤에 닫아도 나가게 한다(keepalive)
 * - resent: 닿지 못한 것을 저절로 다시 보낸다
 */
async function sendLogout(value: string, how: 'pressed' | 'resent'): Promise<void> {
  const pressed = how === 'pressed'
  try {
    await withSessionLock(pressed ? 'steal' : 'fail', async (lost) => {
      if (!pressed) await new Promise((resolve) => setTimeout(resolve, MARKS_ARRIVE_MS))
      // 기다리는 사이 로그인이 끝났으면 방금 한 로그인을 끝내게 되고, 새 로그아웃이 있으면 그것이 보낸다
      if (pendingLogout() !== value) return
      await requestLogout(lost, { keepalive: pressed })
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

/**
 * 앱을 열 때 갱신이 `error`로 실패했다. '연결 없음과 같은 실패'이고 기기의 마지막 로그인 기록이 조건을 모두 만족하며
 * 그 사용자의 계정별 저장을 쓸 수 있으면(`usable`) '확인하지 못한 로그인'으로 열고 그 사용자를 준다. 아니면 없다.
 */
export async function openUnconfirmed(
  error: unknown,
  usable: (userId: string) => Promise<boolean>,
): Promise<string | undefined> {
  if (!isLikeNoConnection(error) || accessToken !== undefined) return undefined
  const seen = { logout: logoutValue(), login: loginValue() }
  const userId = await deviceUser()
  if (userId === undefined || !(await usable(userId))) return undefined
  // 확인하는 사이에 로그인했거나 표시가 바뀌었으면 열지 않는다
  if (accessToken !== undefined || logoutValue() !== seen.logout || loginValue() !== seen.login) return undefined
  unconfirmed = { userId, seen }
  return userId
}

/** 확인하지 못한 로그인이면 연결이 돌아왔을 때 부른다. 기록을 다시 보고 갱신한다. 실패하면 ApiError를 던진다. */
export async function confirmSession(): Promise<void> {
  if (unconfirmed === undefined || accessToken !== undefined) return
  if (!(await stillUnconfirmed())) return
  await renew(undefined)
}

/** 확인하지 못한 로그인이면 기록이 아직 있고 조건을 만족하는지 다시 본다. 아니면 로그인이 풀린 것으로 끝낸다. */
export async function recheckUnconfirmed(): Promise<void> {
  if (unconfirmed === undefined || accessToken !== undefined) return
  await stillUnconfirmed()
}

/** 다른 탭에서 로그아웃했으면 이 탭의 로그인도 끝낸다. 저장소를 모두 지운 것도 로그아웃으로 본다. */
export function noticeLogout({ storageCleared = false } = {}): void {
  if (storageCleared) endSession('logged-out')
  else endIfOver()
}

/** 화면이 브라우저에 보관된다. 되살아날 때까지 다른 화면에서 로그아웃하거나 다른 계정으로 로그인할 수 있다. */
export function suspendSession(): void {
  suspended = true
}

/**
 * 화면이 되살아났다. 그사이 로그아웃하거나 로그인했으면 쓰던 로그인을 버린다.
 * 확인하지 못한 로그인은 기록을 다시 읽어야 하므로 다 볼 때까지 기다릴 것을 준다. 그 밖에는 바로 끝난다.
 */
export function resumeSession(): Promise<void> | undefined {
  endIfOver()
  suspended = false
  return unconfirmed === undefined ? undefined : recheckUnconfirmed()
}

/**
 * 지금 로그인한 사용자의 id(access token의 sub). 로그인하지 않았거나 읽지 못하면 없다. 확인하지 못한 로그인에서도 없다.
 * 서명을 확인하지 않은 값이라 권한 판단에 쓰지 않는다. 보내는 사용자가 같은지 볼 때 쓴다.
 */
export function currentUserId(): string | undefined {
  return accessToken === undefined ? undefined : userOf(accessToken)
}

/**
 * 이 탭의 기기 데이터(사본, 보내지 않은 입력, 쓰던 값)의 주인. 토큰의 sub이고, 확인하지 못한 로그인이면 기록의 사용자다.
 * 기기 데이터를 고르는 데만 쓰고 요청의 사용자로 쓰지 않는다(security 2026-11-26, #234). 요청은 currentUserId로 본다.
 */
export function sessionUserId(): string | undefined {
  return currentUserId() ?? unconfirmed?.userId
}

/** 이 탭에서 쓰던 로그인이 끝나면 부른다. 돌려받은 함수로 끊는다. */
export function onSessionEnded(listener: (end: SessionEnd) => void): () => void {
  endedListeners.add(listener)
  return () => {
    endedListeners.delete(listener)
  }
}

/**
 * 이 탭에서 쓰던 로그인이 풀리기(ended) 직전에 그 로그인의 사용자(기기 데이터 주인)로 부른다. 화면이 아직 그대로라 열린 입력
 * 화면의 쓰던 값을 꺼낼 수 있다(#234 C2). 사용자가 로그아웃했거나 다른 로그인으로 바뀐 때는 부르지 않는다. 돌려받은 함수로 끊는다.
 */
export function onSessionEnding(listener: (userId: string) => void): () => void {
  endingListeners.add(listener)
  return () => {
    endingListeners.delete(listener)
  }
}

/** 확인하지 못한 로그인이 같은 사용자로 확인되면 부른다. 돌려받은 함수로 끊는다. */
export function onSessionConfirmed(listener: () => void): () => void {
  confirmedListeners.add(listener)
  return () => {
    confirmedListeners.delete(listener)
  }
}

/** 보내기 직전에 쓸 토큰의 사용자가 이 사용자와 같아야 보낸다. 저장이나 동작을 시작한 때의 사용자다. */
export interface SenderCheck {
  startedBy: string | undefined
}

/**
 * 지금 access token으로 보내고, 만료됐으면 갱신을 한 번 한 뒤 같은 요청을 다시 보낸다(ADR 001 결정 6).
 *
 * refresh 쿠키는 브라우저의 모든 탭이 함께 쓴다. 다른 탭에서 다른 계정으로 로그인하면 갱신이 그 계정의 토큰을 준다.
 * 앞 사용자의 요청을 다른 사용자로 보내지 않도록, 토큰의 사용자가 같을 때만 다시 보낸다.
 * 토큰 없이 보낸 요청은 누구의 것인지 알 수 없으므로 갱신하지 않는다.
 * 다른 탭에서 로그아웃했으면 보내지 않고 로그인이 필요하다는 오류로 끝낸다.
 * 확인하지 못한 로그인이면 다른 요청보다 먼저 기록을 다시 보고 갱신한다. 같은 사용자로 확인돼야 보낸다.
 * `sender`가 있으면 보낼 때마다(다시 보낼 때 포함) 토큰의 sub가 `startedBy`와 같아야 보낸다. 아니면 지연 오류로 끝낸다.
 */
export async function withAccessToken<T>(
  sendWith: (accessToken: string | undefined) => Promise<T>,
  sender?: SenderCheck,
): Promise<T> {
  if (endIfOver()) throw unauthenticated()
  if (accessToken === undefined && unconfirmed !== undefined) await confirmBeforeRequest()
  const used = accessToken
  checkSender(used, sender)
  try {
    return await sendWith(used)
  } catch (error) {
    if (used === undefined || !isUnauthenticated(error)) throw error
    const renewed = await renew(used)
    if (endIfOver() || renewed === undefined || !isSameUser(used, renewed)) throw error
    checkSender(renewed, sender)
    return sendWith(renewed)
  }
}

/**
 * 확인하지 못한 로그인의 요청 앞에서 갱신한다. 확인되지 않으면 갱신의 오류나 로그인이 필요하다는 오류를 던진다.
 * 다른 사용자로 갱신됐으면 앞 사용자의 화면이 시작한 요청이므로 보내지 않고 지연 오류로 끝낸다.
 */
async function confirmBeforeRequest(): Promise<void> {
  const opened = unconfirmed
  if (!(await stillUnconfirmed())) throw unauthenticated()
  await renew(undefined)
  if (accessToken === undefined) throw unauthenticated()
  if (userOf(accessToken) !== opened?.userId) throw ApiError.timeout()
}

function checkSender(token: string | undefined, sender: SenderCheck | undefined) {
  if (sender === undefined) return
  if (sender.startedBy === undefined || token === undefined || userOf(token) !== sender.startedBy) {
    throw ApiError.timeout()
  }
}

/**
 * 확인하지 못한 로그인을 아직 쓸 수 있는지 기기의 기록으로 다시 본다(다른 탭이 401로 지웠거나 기한이 지났을 수 있다).
 * 쓸 수 없으면 로그인이 풀린 것으로 끝내고 false다.
 */
async function stillUnconfirmed(): Promise<boolean> {
  const opened = unconfirmed
  if (opened === undefined) return false
  const userId = await deviceUser()
  if (unconfirmed !== opened) return accessToken !== undefined
  if (userId === opened.userId && !loggedOutSince(opened.seen) && loginValue() === opened.seen.login) return true
  endSession('ended')
  return false
}

/** 기기의 마지막 로그인 기록으로 열 수 있는 사용자(api/unconfirmedLogin). 기록을 읽지 못하면 없다. */
async function deviceUser(): Promise<string | undefined> {
  try {
    const record = await readLoginRecord()
    const marks = {
      login: loginValue(),
      logout: logoutValue(),
      pendingLogout: pendingLogout() !== undefined,
      shared: marksShared(),
    }
    return unconfirmedUserOf(record, marks, now())
  } catch {
    return undefined
  }
}

/**
 * '연결 없음과 같은 실패'(결정 댓글): 연결 오류, 지연, 5xx, 429, 우리 모양이 아닌 응답(읽을 수 없는 본문, problem+json이 아닌
 * 4xx)뿐이다. 우리 서버가 problem+json으로 거절한 4xx와 탭 사이 잠금 때문에 보내지 못한 것은 아니다.
 */
function isLikeNoConnection(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false
  switch (error.kind) {
    case 'connection':
    case 'server':
      return true
    case 'timeout':
      return !error.lockWait
    case 'rejected':
      return error.status === 429 || error.code === undefined
  }
}

/** `stale` 다음의 access token. 로그인이 필요하면 없다. 그사이 토큰이 바뀌었으면 갱신하지 않고 그것을 준다. */
function renew(stale: string | undefined): Promise<string | undefined> {
  if (accessToken !== stale) return Promise.resolve(accessToken)
  if (!renewal || renewal.stale !== stale) {
    const token = renewUnlessLoggedOut(stale).finally(() => {
      if (renewal?.token === token) renewal = undefined
    })
    renewal = { stale, token }
  }
  return renewal.token
}

/** 시작한 뒤에 로그아웃이 있었으면 보내지 않거나 답을 쓰지 않는다. 이 탭의 로그인은 부른 쪽이 끝낸다(endIfOver). */
async function renewUnlessLoggedOut(stale: string | undefined): Promise<string | undefined> {
  const seen = stale === undefined ? { logout: logoutValue(), login: loginValue() } : seenMarks
  const loggedOut = () => loggedOutSince(seen)
  if (!loggedOut()) {
    try {
      await withSessionLock('fail', async (lost) => {
        if (accessToken === stale && !loggedOut()) await refresh(stale, seen, lost)
      })
    } catch (error) {
      if (!loggedOut()) throw error
    }
  }
  return accessToken
}

/**
 * 늦게 온 응답은 버린다. 잠금을 빼앗겼거나, 잠금 없이 보내는 동안 이 탭에서 로그인해 토큰이 `stale`에서 바뀌었거나,
 * 로그아웃이 있었을 때다.
 */
async function refresh(stale: string | undefined, seen: SeenMarks, lost: AbortSignal): Promise<void> {
  const isCurrent = () => !lost.aborted && accessToken === stale && !loggedOutSince(seen)
  try {
    const renewed = await requestRefreshTwice(lost, seen)
    if (isCurrent()) acceptRenewed(renewed, seen)
  } catch (error) {
    // 연결 문제와 서버 오류는 로그인 풀림이 아니다
    if (!(error instanceof ApiError && error.status === 401)) throw error
    if (!isCurrent()) return
    // 이 표시로 확인한 기록만 지운다. 그사이 다른 탭의 로그인이 쓴 기록은 남긴다
    void forgetLoginRecordOf({ loginValue: seen.login ?? null, logoutValue: seen.logout ?? null }).catch(ignore)
    endSession('ended')
  }
}

/**
 * 답이 없으면 한 번만 더 보낸다. 앞 요청이 서버에서 회전을 마치고 응답만 못 왔다면 쿠키는 옛것이고,
 * 옛 쿠키는 회전 시각부터 10초 안에만 받아들여진다(ADR 001 결정 3). 어떤 답이든 받았으면 다시 보내지 않는다.
 */
async function requestRefreshTwice(lost: AbortSignal, seen: SeenMarks): Promise<string> {
  try {
    return await requestRefresh(lost)
  } catch (error) {
    if (loggedOutSince(seen) || !(error instanceof ApiError && error.kind === 'timeout')) throw error
    return requestRefresh(lost)
  }
}

/**
 * 쓰던 토큰과 사용자가 다르면 이 탭의 로그인은 끝난 것이다. 새 토큰을 두지 않는다.
 * 확인하지 못한 로그인은 기록의 사용자와 같으면 로그인 상태가 되고, 다르면 다시 확인하게 끝낸다.
 */
function acceptRenewed(renewed: string, seen: SeenMarks) {
  if (accessToken !== undefined && !isSameUser(accessToken, renewed)) {
    endSession('ended')
    return
  }
  const confirming = accessToken === undefined ? unconfirmed : undefined
  accessToken = renewed
  seenMarks = seen
  unconfirmed = undefined
  keepConfirmedLogin(renewed, seen, false)
  if (!confirming) return
  // 다른 사용자면 앞 사용자의 화면을 끝내고 다시 확인하게 한다. 새 토큰은 두므로 다시 확인하면 그 사용자로 열린다.
  // 앞 사용자의 사본은 새 기록을 쓸 때 지워지고, 앞 사용자가 시작한 요청은 이 토큰으로 보내지 않는다(confirmBeforeRequest)
  if (userOf(renewed) !== confirming.userId) endedListeners.forEach((notify) => notify('replaced'))
  else confirmedListeners.forEach((notify) => notify())
}

/** 받아들인 로그인을 기기의 마지막 로그인 기록으로 남긴다. 기다리지 않고, 실패해도 로그인은 그대로다. */
function keepConfirmedLogin(token: string, seen: SeenMarks, fresh: boolean) {
  const userId = userOf(token)
  if (userId === undefined) return
  void confirmLogin({
    userId,
    at: now(),
    loginValue: seen.login ?? null,
    logoutValue: seen.logout ?? null,
    fresh,
  }).catch(ignore)
}

/** 이 탭의 로그인을 더 쓰면 안 되면 끝내고 true를 준다. */
function endIfOver(): boolean {
  const end = overAs()
  if (end === undefined) return false
  // 확인했으므로 뒤에 새로 여는 로그인은 보관된 화면의 것이 아니다
  suspended = false
  endSession(end)
  return true
}

function overAs(): SessionEnd | undefined {
  if (accessToken === undefined) return unconfirmed === undefined ? undefined : unconfirmedOverAs(unconfirmed.seen)
  const loggedOut = loggedOutSince(seenMarks)
  if (!suspended) return loggedOut ? 'logged-out' : undefined
  if (loggedOut) return 'replaced-after-logout'
  return isSameLogin(seenMarks) ? undefined : 'replaced'
}

/** 확인하지 못한 로그인은 연 뒤로 로그아웃이 있었거나 다른 로그인이 있었으면(있었을 수 있으면) 쓰지 않는다. */
function unconfirmedOverAs(seen: SeenMarks): SessionEnd | undefined {
  if (loggedOutSince(seen)) return 'logged-out'
  return isSameLogin(seen) ? undefined : 'replaced'
}

/** `seen` 뒤로 로그아웃이 있었거나, 서버에 닿지 않았을 수 있는 로그아웃이 있다. */
function loggedOutSince(seen: SeenMarks): boolean {
  return logoutValue() !== seen.logout || pendingLogout() !== undefined
}

/** `seen` 뒤로 로그인이 없었다. 표시를 나누지 못하거나 남긴 로그인 값이 없으면 알 수 없으므로 아니라고 본다. */
function isSameLogin(seen: SeenMarks): boolean {
  return marksShared() && seen.login !== undefined && loginValue() === seen.login
}

function endSession(end: SessionEnd) {
  const wasSignedIn = accessToken !== undefined || unconfirmed !== undefined
  const userId = sessionUserId()
  if (end === 'ended' && userId !== undefined) endingListeners.forEach((notify) => notify(userId))
  accessToken = undefined
  unconfirmed = undefined
  if (wasSignedIn) endedListeners.forEach((notify) => notify(end))
}

function unauthenticated(): ApiError {
  return ApiError.response(401, { code: UNAUTHENTICATED, fieldErrors: [] })
}

function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401 && error.code === UNAUTHENTICATED
}

function ignore() {
  // 기기 저장소를 쓰지 못해도 로그인과 로그아웃은 그대로 된다
}
