/*
 * 연결이 있는지(00-common 4.3 [판단 28], #234). 브라우저의 online·offline 신호와 요청의 결과를 함께 보고 한 곳에서 정한다.
 * - 요청이 응답 없이 실패하면 곧바로 연결이 없다. 15초 지연은 서버 오류 쪽이라 바꾸지 않는다
 * - X-Request-Id가 있는 응답을 받으면 상태 코드와 상관없이 연결이 있다. 우리 프록시와 서버를 거친 응답에만 있다(ADR 005
 *   결정 7). 포털 페이지처럼 우리 서버에 닿지 않은 응답으로 연결이 있다고 보지 않는다(architect 결정 2026-11-26)
 * - 신호는 켜져 있는데 요청이 실패해 없음이 되면 브라우저가 online 신호를 다시 주지 않으므로, 연결이 돌아왔는지 확인하는
 *   요청을 보낸다(architect 결정 2026-11-26, #234 Q10)
 * 테스트는 navigator.onLine과 이벤트, 응답 없는 요청으로 바꾼다(tests/support/connection.ts).
 */

export type Connection = 'online' | 'offline'

/** 우리 프록시가 만들고 서버가 응답에 싣는 헤더(ADR 005 결정 7, ADR 002 4절) */
const REQUEST_ID = 'X-Request-Id'

/** 확인 요청 사이의 간격. 앞 확인의 답을 받은 때부터 잰다. 마지막 값을 되풀이한다 */
const PROBE_GAPS_MS = [5_000, 10_000, 20_000, 30_000]

/** 확인 요청 하나를 기다리는 시간 */
const PROBE_TIMEOUT_MS = 10_000

/** 앱을 열 때의 브라우저 신호에서 시작해, 그 뒤로는 신호와 요청 결과로 바꾼다. */
let state: Connection = browserOffline() ? 'offline' : 'online'
const listeners = new Set<(next: Connection) => void>()

/** 지켜보는 중인지. 확인 요청은 이때만 보낸다 */
let watching: AbortController | undefined
let probeTimer: ReturnType<typeof setTimeout> | undefined
let probing = false
let probeCount = 0

/** 지금 연결이 있는지 */
export function connection(): Connection {
  return state
}

/** 연결이 바뀔 때마다 부른다. 돌려받은 함수로 끊는다. */
export function onConnectionChange(listener: (next: Connection) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 요청이 응답 없이 실패했다(http.ts만 부른다). */
export function reportNoResponse(): void {
  set('offline')
  if (watching && !browserOffline()) startProbing()
}

/** 응답을 받았다(http.ts만 부른다). 우리 서버를 거친 응답일 때만 연결이 있다고 본다. */
export function reportResponse(headers: Headers): void {
  if (!headers.has(REQUEST_ID)) return
  set('online')
  stopProbing()
}

/** 브라우저의 신호를 받기 시작한다. 앱이 열려 있는 동안 한 번 부른다. 돌려받은 함수로 멈춘다. */
export function watchConnection(): () => void {
  watching?.abort()
  const watched = new AbortController()
  watching = watched
  const { signal } = watched
  window.addEventListener(
    'offline',
    () => {
      set('offline')
      stopProbing()
    },
    { signal },
  )
  window.addEventListener(
    'online',
    () => {
      set('online')
      stopProbing()
    },
    { signal },
  )
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState === 'visible' && needsProbe()) {
        clearTimeout(probeTimer)
        probeTimer = undefined
        void probe()
      }
    },
    { signal },
  )
  return () => {
    watched.abort()
    if (watching === watched) watching = undefined
    stopProbing()
  }
}

function set(next: Connection) {
  if (state === next) return
  state = next
  listeners.forEach((notify) => notify(next))
}

function browserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

function needsProbe(): boolean {
  return watching !== undefined && connection() === 'offline' && !browserOffline()
}

function startProbing() {
  if (probeTimer !== undefined || probing) return
  scheduleProbe()
}

function scheduleProbe() {
  const gap = PROBE_GAPS_MS[Math.min(probeCount, PROBE_GAPS_MS.length - 1)]
  probeTimer = setTimeout(() => {
    probeTimer = undefined
    void probe()
  }, gap)
}

function stopProbing() {
  clearTimeout(probeTimer)
  probeTimer = undefined
  probeCount = 0
}

async function probe() {
  if (probing) return
  probing = true
  probeCount += 1
  const answered = await sendProbe()
  probing = false
  if (answered) {
    set('online')
    stopProbing()
  } else if (needsProbe() && probeTimer === undefined) {
    scheduleProbe()
  }
}

/**
 * 연결 확인 요청. API 요청은 http.ts에서만 보내고 이것만 여기서 보낸다(본문, 토큰, 쿠키가 없다).
 * 서버는 problem+json 404로 답한다. service worker는 /api/를 가로채지 않으므로 실제 연결을 본다.
 */
async function sendProbe(): Promise<boolean> {
  const aborter = new AbortController()
  const timer = setTimeout(() => aborter.abort(), PROBE_TIMEOUT_MS)
  try {
    const response = await fetch('/api/v1/', {
      method: 'HEAD',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: aborter.signal,
    })
    return response.headers.has(REQUEST_ID)
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
