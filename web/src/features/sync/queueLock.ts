/*
 * 대기열을 보내거나 버리는 동안 쥐는 탭 사이 잠금(architect #235 B, #236). 세션 잠금(akkimpyo-session)과 다르다.
 * 저절로 보내기는 다른 탭이 쥐고 있으면 기다리지 않고 건너뛴다. 사용자가 누른 동작(지금 보내기, 버리기)은 놓을 때까지 기다리고,
 * 15초가 지나도 놓지 않으면(멈춘 탭이 쥐고 있음) 그만두고 QueueBusy를 던진다.
 */

/** 탭 사이 잠금의 이름 */
const LOCK_NAME = 'akkimpyo-queue'

/** 사용자가 누른 동작이 잠금을 기다리는 시간. 세션 잠금의 기다림과 같다 */
export const QUEUE_WAIT_MS = 15_000

/** 다른 탭이 잠금을 쥔 채 QUEUE_WAIT_MS 안에 놓지 않았다 */
export class QueueBusy extends Error {
  override readonly name = 'QueueBusy'
}

interface LockOptions {
  /** 쥔 탭이 있으면 놓을 때까지 기다린다(사용자가 누른 동작). 아니면 건너뛴다 */
  wait?: boolean
}

/**
 * 잠금을 쥐고 `work`를 한다. 건너뛰었으면 false다. 잠금 기능이 없거나 막힌 브라우저에서는 잠금 없이 한다. 같은 id를 두 탭이
 * 보내도 서버는 200(재전송)으로 답하고, 줄은 보낼 때 본 것과 같을 때만 바꾸므로 두 번 바뀌지 않는다.
 */
export async function withQueueLock(work: () => Promise<void>, { wait = false }: LockOptions = {}): Promise<boolean> {
  if (!('locks' in navigator)) {
    await work()
    return true
  }
  const waiting = wait ? new AbortController() : undefined
  const timer = waiting && setTimeout(() => waiting.abort(), QUEUE_WAIT_MS)
  let granted = false
  try {
    await navigator.locks.request(LOCK_NAME, waiting ? { signal: waiting.signal } : { ifAvailable: true }, async (lock) => {
      clearTimeout(timer)
      if (!lock) return
      granted = true
      await work()
    })
    return granted
  } catch (error) {
    if (granted) throw error
    if (waiting?.signal.aborted) throw new QueueBusy('대기열 잠금을 기다리다 그만뒀다')
    await work()
    return true
  } finally {
    clearTimeout(timer)
  }
}
