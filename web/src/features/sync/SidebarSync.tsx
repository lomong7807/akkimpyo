import SyncedTime from './SyncedTime'
import { usePendingCounts } from './useSyncState'
import styles from './SidebarSync.module.css'

/**
 * 넓은 화면 사이드바 맨 아래 묶음의 보내지 않은 입력 줄(2-4)과 마지막으로 맞춘 시각(2-3)(00-common 6.1, 6.5). 0건이면 2-4가 없고
 * 2-3만 있다. 2-4는 1B 동안 누를 수 없다(B-05로 가는 것은 #236). 자리는 지금 44px로 잡는다(designer #235 Q3).
 */
export default function SidebarSync() {
  const { waiting, rejected } = usePendingCounts()
  const total = waiting + rejected
  return (
    <>
      {total > 0 && (
        <div className={styles.counts}>
          <p className={styles.count}>{`보내지 않은 입력 ${total}건`}</p>
          {rejected > 0 && <p className={`${styles.count} ${styles.rejected}`}>{`그중 보낼 수 없음 ${rejected}건`}</p>}
        </div>
      )}
      <SyncedTime className={styles.time} />
    </>
  )
}
