/*
 * 기기 저장소의 바뀜 알림. 같은 탭과 다른 탭에 무엇이 바뀌었는지만 알리고 내용은 싣지 않는다. 받는 쪽은 저장소를 다시 읽는다
 * (security 2026-11-26). BroadcastChannel이 없는 브라우저에서는 같은 탭에만 알린다.
 * - queue: 보내지 않은 입력의 대기열(#234 B)
 * - synced: 마지막으로 맞춘 시각(사본을 새로 받음, 보내기 성공. #235)
 */

export type DeviceChange = 'queue' | 'synced'

const CHANNEL = 'akkimpyo-device'
const CHANGES: readonly DeviceChange[] = ['queue', 'synced']
const listeners = new Map<DeviceChange, Set<() => void>>(CHANGES.map((change) => [change, new Set()]))
let channel: BroadcastChannel | undefined

/** 그것이 바뀔 때마다 부른다(이 탭과 다른 탭). 돌려받은 함수로 끊는다. */
export function onDeviceChange(change: DeviceChange, listener: () => void): () => void {
  listeners.get(change)!.add(listener)
  openChannel()
  return () => {
    listeners.get(change)!.delete(listener)
  }
}

/** 이 탭에서 바꿨다. 이 탭에 알리고 다른 탭에 보낸다. */
export function announce(change: DeviceChange): void {
  notify(change)
  openChannel()?.postMessage({ changed: change })
}

function notify(change: DeviceChange) {
  listeners.get(change)!.forEach((listener) => listener())
}

function openChannel(): BroadcastChannel | undefined {
  if (channel || typeof BroadcastChannel === 'undefined') return channel
  channel = new BroadcastChannel(CHANNEL)
  channel.onmessage = ({ data }: MessageEvent<unknown>) => {
    const change = (data as { changed?: unknown } | null)?.changed
    const known = CHANGES.find((each) => each === change)
    if (known) notify(known)
  }
  return channel
}
