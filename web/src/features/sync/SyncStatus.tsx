import { useLocation } from 'react-router'
import Icon from '../../components/Icon'
import { CloudArrowUp, WarningCircle } from '../../components/icons'
import { Link } from '../../components/Link'
import { pendingSummary, PENDING_PATH, usePendingCounts } from './useSyncState'
import styles from './SyncStatus.module.css'

/**
 * 동기화 상태 표시(B-04, F-104, 00-common 6.5). 휴대폰 배치의 상단 바 오른쪽(하위 화면은 화면별 버튼의 왼쪽)에 둔다.
 * 보내지 않은 입력(이 기기, 이 계정, 모든 장부)이 1건 이상일 때만 보이고 0건이면 자리도 없다. 보낼 수 없음(2-2)을 대기(2-1)의
 * 왼쪽에 두고 둘을 한 덩어리로 묶는다. 보내는 중에도 모양은 같고 건수만 준다(돌아가는 원 없음).
 * 누르면 보내지 않은 입력 목록(B-05)으로 간다(#236). 한 덩어리의 누르는 자리는 44px 이상이다. B-05 자신의 상단 바에는 두지 않는다
 * (자기 자신을 가리키고 같은 건수가 목록에 있으며, 좁은 화면에서 화면 제목을 자른다. designer #236).
 * 화면 읽기에는 이름 한 줄만 읽히고 보이는 아이콘·건수는 읽히지 않는다.
 */
export default function SyncStatus() {
  const { waiting, rejected } = usePendingCounts()
  const { pathname } = useLocation()
  if (waiting + rejected === 0 || pathname === PENDING_PATH) return null
  return (
    <Link to={PENDING_PATH} className={styles.syncStatus}>
      <span className={styles.spoken}>{pendingSummary(waiting + rejected, rejected)}</span>
      {rejected > 0 && (
        <span aria-hidden className={`${styles.part} ${styles.rejected}`}>
          <Icon icon={WarningCircle} size={20} />
          {`${rejected}건`}
        </span>
      )}
      {waiting > 0 && (
        <span aria-hidden className={styles.part}>
          <Icon icon={CloudArrowUp} size={20} />
          {`${waiting}건`}
        </span>
      )}
    </Link>
  )
}
