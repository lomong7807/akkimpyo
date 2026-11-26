import { useSyncExternalStore } from 'react'
import { connection, offlineCause, onConnectionChange } from '../../api/connection'

/*
 * 연결 없음 띠를 보일지(00-common 6.1 (6) [판단 56], F-908, #235). 화면마다 띠를 그리지만 시간은 여기 한 곳에서 잰다. 화면을
 * 옮겨도 2초를 처음부터 다시 세지 않는다.
 * - 연결 없음(api/connection)이 2초 넘게 이어지면 띄운다. 요청이 연결 문제로 실패했으면 바로 띄운다
 * - 연결이 돌아오면 바로 지운다. 띠가 보였으면 화면 읽기 프로그램에 "다시 연결됐어요"를 알린다(눈에 보이는 토스트는 없다)
 */

/** 연결 없음이 이만큼 이어지면 띠를 띄운다. 잠깐 끊겼다 붙는 연결에 띠가 깜빡이지 않게 한다 */
export const BAND_DELAY_MS = 2_000

export type BandState = 'hidden' | 'shown' | 'reconnected'

let state: BandState = 'hidden'
let timer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()

function set(next: BandState) {
  if (state === next) return
  state = next
  listeners.forEach((notify) => notify())
}

function update() {
  if (connection() === 'online') {
    clearTimeout(timer)
    timer = undefined
    if (state === 'shown') set('reconnected')
    return
  }
  if (state === 'shown') return
  // 다시 연결됐다는 알림은 다음에 끊길 때 지운다
  if (state === 'reconnected') set('hidden')
  if (offlineCause() === 'request') {
    clearTimeout(timer)
    timer = undefined
    set('shown')
    return
  }
  timer ??= setTimeout(() => {
    timer = undefined
    if (connection() === 'offline') set('shown')
  }, BAND_DELAY_MS)
}

/** 연결을 지켜보기 시작한다. 공통 틀이 있는 동안 한 번 부른다. 돌려받은 함수로 멈춘다. */
export function watchConnectionBand(): () => void {
  update()
  const stop = onConnectionChange(update)
  return () => {
    stop()
    clearTimeout(timer)
    timer = undefined
    state = 'hidden'
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 지금 띠의 상태 */
export function bandStateNow(): BandState {
  return state
}

/** 띠의 상태. 바뀌면 다시 그린다 */
export function useConnectionBand(): BandState {
  return useSyncExternalStore(subscribe, bandStateNow)
}
