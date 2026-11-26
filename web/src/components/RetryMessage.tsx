import type { MouseEvent } from 'react'
import { Button, ButtonLink } from './Button'
import ErrorMessage from './ErrorMessage'
import styles from './RetryMessage.module.css'

type RetryMessageProps = {
  children: string
  /** 나타날 때 버튼에 초점을 둔다 */
  autoFocus?: boolean
  /**
   * 실패한 횟수. 바뀌면 문구만 새로 그려 같은 문구여도 다시 읽히게 한다. 버튼은 그대로 두어 초점을 잃지 않는다.
   */
  failures?: number
} & (
  | {
      onRetry: () => void
      /** 버튼의 글자. 없으면 "다시 시도"다. */
      actionLabel?: string
      /** 이 버튼으로 다시 보내는 중. 문구는 둔 채 버튼에 도는 표시를 둔다(확인 창과 같다). */
      busy?: boolean
      /** 다른 버튼으로 보내는 중이라 누를 수 없다. */
      disabled?: boolean
      to?: never
      onClick?: never
    }
  | {
      /** 누르면 가는 주소. 버튼은 링크로 그린다. */
      to: string
      actionLabel: string
      /** 링크를 누를 때. 화면이 가는 길을 정하려면 기본 동작을 막고 직접 간다. */
      onClick?: (event: MouseEvent<HTMLAnchorElement>) => void
      onRetry?: never
      busy?: never
      disabled?: never
    }
)

/**
 * 보내지 못했다는 문구와 글자 버튼 하나. 누른 버튼 바로 위에 둔다(화면설계서 00-common 4.3).
 * 버튼은 기본으로 "다시 시도"이고, 다른 동작이 맞는 실패는 그 동작을 준다.
 */
export default function RetryMessage({
  children,
  onRetry,
  actionLabel = '다시 시도',
  to,
  onClick,
  busy,
  disabled,
  autoFocus,
  failures,
}: RetryMessageProps) {
  return (
    <div className={styles.message}>
      <ErrorMessage key={failures} role="alert">
        {children}
      </ErrorMessage>
      <div className={styles.retry}>
        {to === undefined ? (
          <Button kind="text" onClick={onRetry} autoFocus={autoFocus} busy={busy} disabled={disabled}>
            {actionLabel}
          </Button>
        ) : (
          <ButtonLink kind="text" to={to} autoFocus={autoFocus} onClick={onClick}>
            {actionLabel}
          </ButtonLink>
        )}
      </div>
    </div>
  )
}
