import { useLoadingMessage } from '../components/useLoadingMessage'
import styles from './Loading.module.css'

/** 보일 수 있는 것이 아직 하나도 없는 동안의 화면 */
export default function Loading() {
  const message = useLoadingMessage()
  return (
    <p role="status" className={styles.loading}>
      {message}
    </p>
  )
}
