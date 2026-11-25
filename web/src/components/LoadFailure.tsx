import type { ReactNode } from 'react'
import { Button } from './Button'
import ScreenMessage from './ScreenMessage'

interface LoadFailureProps {
  onRetry: () => void
  /** 다시 불러오는 중. 안내는 그대로 두고 버튼만 처리 중으로 바꾼다. */
  busy?: boolean
  /** "다시 시도" 아래에 놓는 다른 동작 */
  children?: ReactNode
}

/** 내용을 불러오지 못했다(F-907). */
export default function LoadFailure({ onRetry, busy, children }: LoadFailureProps) {
  return (
    <ScreenMessage title="불러오지 못했어요." description="잠시 후 다시 시도해 주세요.">
      <Button kind="text" busy={busy} onClick={onRetry}>
        다시 시도
      </Button>
      {children}
    </ScreenMessage>
  )
}
