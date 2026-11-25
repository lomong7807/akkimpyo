import { ButtonLink } from '../../components/Button'
import { MainScreen } from '../../components/Screen'
import styles from './NotFoundPage.module.css'

/** N-01 찾을 수 없음 */
export default function NotFoundPage() {
  return (
    <MainScreen>
      <div className={styles.notFound}>
        <h1>찾을 수 없어요.</h1>
        <p className={styles.description}>주소가 바뀌었거나 지워진 항목일 수 있어요.</p>
        <ButtonLink kind="primary" to="/home">
          홈으로
        </ButtonLink>
      </div>
    </MainScreen>
  )
}
