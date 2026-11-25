import { noticeLogout, resendLogout, resumeSession, suspendSession } from '../api/session'

/**
 * 다른 탭의 로그아웃과 브라우저가 보관했다 되살린 화면(bfcache), 다시 된 연결을 세션 계층에 알린다.
 * 저장소 신호는 잠든 탭에 오지 않을 수 있으므로 화면이 다시 보일 때와 열릴 때도 본다. 요청 직전에는 세션 계층이 스스로 본다.
 *
 * 보관될 때 화면을 미리 가린다. 되살아난 화면은 스크립트보다 먼저 그려진다.
 * `onResumed`를 받은 쪽이 확인 결과를 그린 뒤 `uncoverPage`로 연다.
 */
export function watchSession(onResumed: () => void): () => void {
  const watching = new AbortController()
  const { signal } = watching

  window.addEventListener('storage', ({ key }) => noticeLogout({ storageCleared: key === null }), { signal })
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState === 'visible') noticeLogout()
    },
    { signal },
  )
  window.addEventListener(
    'pagehide',
    ({ persisted }) => {
      if (!persisted) return
      suspendSession()
      stored = true
      document.documentElement.setAttribute(COVERED, '')
    },
    { signal },
  )
  window.addEventListener(
    'pageshow',
    ({ persisted }) => {
      if (!persisted) return noticeLogout()
      resumeSession()
      stored = false
      onResumed()
    },
    { signal },
  )
  window.addEventListener('online', resendLogout, { signal })

  return () => watching.abort()
}

// 모양은 styles/base.css에 있다
const COVERED = 'data-covered'

/** 브라우저가 화면을 보관하고 있다. */
let stored = false

/** 화면을 연다. 보관돼 있는 동안에는 열지 않는다. */
export function uncoverPage(): void {
  if (!stored) document.documentElement.removeAttribute(COVERED)
}
