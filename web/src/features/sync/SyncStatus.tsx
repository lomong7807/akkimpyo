import Icon from '../../components/Icon'
import { usePendingCounts } from './useSyncState'
import styles from './SyncStatus.module.css'

/** B-04의 이름. 보낼 수 없음이 없으면 둘째 구절을 뺀다(00-common 6.5). 1B 동안은 눌리지 않아 ", 목록 보기"를 붙이지 않는다 */
function pendingSummary(total: number, rejected: number): string {
  return rejected > 0 ? `보내지 않은 입력 ${total}건, 그중 보낼 수 없음 ${rejected}건` : `보내지 않은 입력 ${total}건`
}

/**
 * 동기화 상태 표시(B-04, F-104, 00-common 6.5). 휴대폰 배치의 상단 바 오른쪽(하위 화면은 화면별 버튼의 왼쪽)에 둔다.
 * 보내지 않은 입력(이 기기, 이 계정, 모든 장부)이 1건 이상일 때만 보이고 0건이면 자리도 없다. 보낼 수 없음(2-2)을 대기(2-1)의
 * 왼쪽에 두고 둘을 한 덩어리로 묶는다. 보내는 중에도 모양은 같고 건수만 준다(돌아가는 원 없음).
 * 1B 동안은 누를 수 없는 글자 묶음이다. 갈 곳(B-05)은 #236이 만들고 버튼으로 바꾼다(designer #235 Q3). 자리는 지금 44px로 잡는다.
 * 화면 읽기에는 이름 한 줄만 읽히고 보이는 아이콘·건수는 읽히지 않는다.
 */
export default function SyncStatus() {
  const { waiting, rejected } = usePendingCounts()
  if (waiting + rejected === 0) return null
  return (
    <p className={styles.syncStatus}>
      <span className={styles.spoken}>{pendingSummary(waiting + rejected, rejected)}</span>
      {rejected > 0 && (
        <span aria-hidden className={`${styles.part} ${styles.rejected}`}>
          <Icon name="WarningCircle" size={20} />
          {`${rejected}건`}
        </span>
      )}
      {waiting > 0 && (
        <span aria-hidden className={styles.part}>
          <Icon name="CloudArrowUp" size={20} />
          {`${waiting}건`}
        </span>
      )}
    </p>
  )
}
