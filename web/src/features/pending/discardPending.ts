import { readPending, removePending } from '../../device/pendingQueue'
import { withQueueLock } from '../sync/queueLock'

/** discarded: 지웠다. gone: 잠금을 기다리는 사이 보내져(또는 다른 탭이 버려) 이미 없다 */
export type Discarded = 'discarded' | 'gone'

/**
 * 버리기(F-109, B-05 (5)). 기기 안의 동작이라 연결과 상관없다. 보내기와 같은 탭 사이 잠금을 기다렸다가(보내는 중이면 끝난 뒤)
 * 그 줄이 아직 있으면 지운다. 보내는 중인 줄을 지우면 서버에는 저장되고 기기에서만 사라지기 때문이다(#236).
 * 다른 탭이 15초 안에 잠금을 놓지 않으면 QueueBusy를, 기기 저장소를 쓸 수 없으면 DeviceUnavailable을 던진다.
 */
export async function discardPending(userId: string, id: string): Promise<Discarded> {
  let outcome: Discarded = 'gone'
  await withQueueLock(
    async () => {
      if (!(await readPending(userId, id))) return
      await removePending(userId, id)
      outcome = 'discarded'
    },
    { wait: true },
  )
  return outcome
}
