import { syncedText } from './syncedText'
import { useEveryMinute, useSyncedAt } from './useSyncState'

/**
 * 마지막으로 맞춘 시각(B-04 (2-3)). 더보기 맨 아래(M-01 (16))와 넓은 화면 사이드바 맨 아래에 둔다. 누를 수 없다. 서버와 맞출 때마다
 * 바로 바뀐다. 읽기 전이나 기기 저장소를 읽지 못하면 그리지 않는다.
 */
export default function SyncedTime({ className }: { className?: string }) {
  const syncedAt = useSyncedAt()
  useEveryMinute()
  if (syncedAt === undefined) return null
  return <p className={className}>{syncedText(syncedAt ?? undefined)}</p>
}
