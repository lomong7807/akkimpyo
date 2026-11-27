import type { ReactNode } from 'react'
import { Button } from './Button'
import ScreenMessage from './ScreenMessage'

interface LoadFailureProps {
  onRetry: () => void
  /** 다시 불러오는 중. 안내는 그대로 두고 버튼만 처리 중으로 바꾼다. */
  busy?: boolean
  /** 화면 이름(h1)이 따로 있는 하위 화면에서는 2다. 모양은 같다. */
  headingLevel?: 1 | 2
  /**
   * 연결이 없다. 둘째 줄이 "연결되면 자동으로 불러올게요."로 바뀌고 버튼과 아래 동작을 두지 않는다(00-common 4.3, N-03).
   * 연결이 돌아오면 부른 쪽이 저절로 다시 불러온다. 연결은 features가 읽어 넘긴다(components는 연결을 모른다).
   */
  offline?: boolean
  /** "다시 시도" 아래에 놓는 다른 동작 */
  children?: ReactNode
}

/** 내용을 불러오지 못했다(F-907, F-908). */
export default function LoadFailure({ onRetry, busy, headingLevel, offline = false, children }: LoadFailureProps) {
  return (
    <ScreenMessage
      title="불러오지 못했어요."
      description={offline ? '연결되면 자동으로 불러올게요.' : '잠시 후 다시 시도해 주세요.'}
      headingLevel={headingLevel}
    >
      {!offline && (
        <>
          <Button kind="text" busy={busy} onClick={onRetry}>
            다시 시도
          </Button>
          {children}
        </>
      )}
    </ScreenMessage>
  )
}
