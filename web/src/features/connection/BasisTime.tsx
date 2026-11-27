import { basisText } from '../../lib/timeText'
import { useEveryMinute } from '../sync/useSyncState'

/**
 * 연결이 없거나 새로 불러오지 못했을 때 잔액과 합계 머리 줄 오른쪽에 붙이는 기준 시각(N-03 (5), F-908). "10:42 기준"처럼
 * 보이는 값을 서버에서 받은 시각이다. 열어 둔 채 자정이 지나면 날짜를 붙이도록 1분마다 다시 그린다. 모양은 부른 쪽이 정한다.
 */
export default function BasisTime({ at, className }: { at: number; className?: string }) {
  useEveryMinute()
  return <span className={className}>{basisText(at)}</span>
}
