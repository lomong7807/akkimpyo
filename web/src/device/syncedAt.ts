import { announce, onDeviceChange } from './changes'
import { copiesOf, USER_SCOPE } from './copies'
import { isInstantMs, resultOf, transact } from './deviceDb'

/*
 * 마지막으로 맞춘 시각(B-04 (2-3), F-104, 작성자 판단 61, #235). 서버에서 받아 기기에 저장한 사본을 새로 고친 마지막 시각과
 * 보내지 않은 입력을 보내는 데 성공한 마지막 시각 중 늦은 것이다. 보낸 시각은 사본 저장소의 사용자 단위 줄에 두어, 사본과 함께
 * 로그아웃·30일 기한·다른 사용자의 로그인 때 지워진다(architect #235 F).
 */

interface SentRow {
  userId: string
  scope: typeof USER_SCOPE
  kind: 'sent'
  at: number
}

/** 보내기에 성공한 시각을 남긴다. 남긴 시각보다 앞이면 그대로 둔다(늦게 끝난 보내기가 시각을 되돌리지 않는다). */
export async function markSent(userId: string, at: number): Promise<void> {
  const changed = await transact(['copies'], 'readwrite', async (transaction) => {
    const store = transaction.objectStore('copies')
    const last = sentAtOf(await resultOf(store.get([userId, USER_SCOPE, 'sent'])))
    if (last !== undefined && last >= at) return false
    const row: SentRow = { userId, scope: USER_SCOPE, kind: 'sent', at }
    store.put(row)
    return true
  })
  if (changed) announce('synced')
}

/** 그 사용자의 마지막으로 맞춘 시각(밀리초). 한 번도 맞추지 못했으면 없다. 저장소를 쓸 수 없으면 DeviceUnavailable을 던진다. */
export async function readSyncedAt(userId: string): Promise<number | undefined> {
  const [copies, sent] = await Promise.all([
    copiesOf(userId),
    transact(['copies'], 'readonly', (transaction) => resultOf(transaction.objectStore('copies').get([userId, USER_SCOPE, 'sent']))),
  ])
  const times = copies.map(({ receivedAt }) => receivedAt)
  const sentAt = sentAtOf(sent)
  if (sentAt !== undefined) times.push(sentAt)
  return times.length === 0 ? undefined : Math.max(...times)
}

/** 마지막으로 맞춘 시각이 바뀔 수 있을 때마다 부른다(이 탭과 다른 탭). 돌려받은 함수로 끊는다. */
export function onSyncedChanged(listener: () => void): () => void {
  return onDeviceChange('synced', listener)
}

function sentAtOf(value: unknown): number | undefined {
  const at = (value as Partial<SentRow> | null | undefined)?.at
  return isInstantMs(at) ? at : undefined
}
