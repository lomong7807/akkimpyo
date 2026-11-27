import { useId, useRef, type ReactNode } from 'react'
import { Button } from './Button'
import { useDragDown } from './dragDown'
import Overlay from './Overlay'
import styles from './BottomSheet.module.css'

interface BottomSheetProps {
  open: boolean
  title: string
  /** X를 누를 수 없게 둔다(안에서 처리 중일 때). 닫는 다른 길은 onClose를 받는 쪽이 막는다. */
  closeDisabled?: boolean
  /** 안의 내용이 제목에 초점을 줄 수 있게 한다(tabindex=-1, 탭 순서에는 없다). 00-common 5.4 */
  titleFocusable?: boolean
  onClose: () => void
  children: ReactNode
}

/** 바닥 시트(화면설계서 00-common 5.4). 초점은 안의 내용이 useEffect에서 옮긴다. */
export default function BottomSheet({
  open,
  title,
  closeDisabled = false,
  titleFocusable = false,
  onClose,
  children,
}: BottomSheetProps) {
  const titleId = useId()
  const sheet = useRef<HTMLDivElement>(null)
  const dragHandlers = useDragDown(sheet, onClose)
  return (
    <Overlay open={open} aria-labelledby={titleId} scrim onClose={onClose}>
      <div ref={sheet} className={styles.sheet}>
        <div className={styles.head} {...dragHandlers}>
          <div className={styles.handle} aria-hidden="true" />
          <div className={styles.titleRow}>
            <h2 id={titleId} className={styles.title} tabIndex={titleFocusable ? -1 : undefined}>
              {title}
            </h2>
            <Button kind="icon" icon="X" aria-label="닫기" disabled={closeDisabled} onClick={onClose} />
          </div>
        </div>
        <div className={styles.content}>{children}</div>
      </div>
    </Overlay>
  )
}
