import Icon from '../../components/Icon'
import { useConnectionBand } from './bandState'
import styles from './ConnectionBand.module.css'

/**
 * 연결 없음 띠(00-common 6.1 (6) [판단 56], F-908, N-03 (4)). 공통 틀이 화면의 상단 바·머리 바로 아래에 둔다(ShellContext).
 * 알림 영역(`role="status"`)은 늘 두어 나타날 때 문구를 읽어 주고, 연결이 돌아오면 띠를 지우며 같은 영역에서 "다시 연결됐어요"를
 * 읽어 준다(눈에 보이지 않는다). 누를 수 없다.
 */
export default function ConnectionBand() {
  const band = useConnectionBand()
  return (
    <div role="status" className={styles.connectionBand}>
      {band === 'shown' && (
        <p className={styles.bar}>
          <Icon name="WifiSlash" size={20} />
          <span>연결이 없어요. 새 거래 입력만 돼요.</span>
        </p>
      )}
      {band === 'reconnected' && <span className={styles.spoken}>다시 연결됐어요</span>}
    </div>
  )
}
