import { NavLink } from '../../components/Link'
import SyncedTime from './SyncedTime'
import { pendingSummary, PENDING_PATH, usePendingCounts } from './useSyncState'
import styles from './SidebarSync.module.css'

/**
 * 넓은 화면 사이드바 맨 아래 묶음의 보내지 않은 입력 줄(2-4)과 마지막으로 맞춘 시각(2-3)(00-common 6.1, 6.5). 0건이면 2-4가 없고
 * 2-3만 있다. 2-4는 누르면 보내지 않은 입력 목록(B-05)으로 가는 줄이고 누르는 자리는 44px 이상이다(#236). 이름은 B-04와 같다.
 * B-05를 보는 동안은 다른 사이드바 줄처럼 지금 화면 표시(aria-current, 색만)를 둔다(designer #236).
 */
export default function SidebarSync() {
  const { waiting, rejected } = usePendingCounts()
  const total = waiting + rejected
  return (
    <>
      {total > 0 && (
        <NavLink to={PENDING_PATH} end className={styles.counts} aria-label={pendingSummary(total, rejected)}>
          <span className={styles.count}>{`보내지 않은 입력 ${total}건`}</span>
          {rejected > 0 && <span className={`${styles.count} ${styles.rejected}`}>{`그중 보낼 수 없음 ${rejected}건`}</span>}
        </NavLink>
      )}
      <SyncedTime className={styles.time} />
    </>
  )
}
