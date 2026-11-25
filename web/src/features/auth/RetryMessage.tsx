import { Button } from '../../components/Button'
import ErrorMessage from '../../components/ErrorMessage'
import styles from './RetryMessage.module.css'

interface RetryMessageProps {
  children: string
  onRetry: () => void
}

/** 보내지 못했다는 문구와 "다시 시도". 누른 버튼 바로 위에 둔다(화면설계서 00-common 4.3). */
export default function RetryMessage({ children, onRetry }: RetryMessageProps) {
  return (
    <div>
      <ErrorMessage role="alert">{children}</ErrorMessage>
      <div className={styles.retry}>
        <Button kind="text" onClick={onRetry}>
          다시 시도
        </Button>
      </div>
    </div>
  )
}
