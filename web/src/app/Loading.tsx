import { useLoadingMessage } from '../components/useLoadingMessage'
import styles from './Loading.module.css'

/**
 * 화면에 보이는 한 문장이라 마침표를 찍지 않는다(화면설계서 00-common 3.1).
 * 화면 읽기에만 알리는 뼈대의 글(useLoadingMessage)은 대체 글이라 찍는다. designer 결정(#206)
 */
const visibleMessage = '불러오고 있어요'

/** 보일 수 있는 것이 아직 하나도 없는 동안의 화면 */
export default function Loading() {
  const shown = useLoadingMessage() !== undefined
  return (
    <p role="status" className={styles.loading}>
      {shown && visibleMessage}
    </p>
  )
}
