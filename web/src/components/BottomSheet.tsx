import { useId, useRef, type PointerEvent, type ReactNode, type RefObject } from 'react'
import { Button } from './Button'
import Overlay from './Overlay'
import styles from './BottomSheet.module.css'

/** 시트 높이에서 이만큼보다 많이 끌어내리고 놓으면 닫는다. */
const CLOSE_RATIO = 1 / 4

interface BottomSheetProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}

/** 바닥 시트(화면설계서 00-common 5.4). 초점은 안의 내용이 useEffect에서 옮긴다. */
export default function BottomSheet({ open, title, onClose, children }: BottomSheetProps) {
  const titleId = useId()
  const sheet = useRef<HTMLDivElement>(null)
  const dragHandlers = useDragDown(sheet, onClose)
  return (
    <Overlay open={open} aria-labelledby={titleId} scrim onClose={onClose}>
      <div ref={sheet} className={styles.sheet}>
        <div className={styles.head} {...dragHandlers}>
          <div className={styles.handle} aria-hidden="true" />
          <div className={styles.titleRow}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            <Button kind="icon" icon="X" aria-label="닫기" onClick={onClose} />
          </div>
        </div>
        <div className={styles.content}>{children}</div>
      </div>
    </Overlay>
  )
}

/** 머리를 아래로 끌면 시트가 따라 내려온다. */
function useDragDown(sheet: RefObject<HTMLElement | null>, onClose: () => void) {
  const startY = useRef<number>(undefined)

  // 손가락을 따라가는 값이라 CSS에 적어 둘 수 없다. 끌 때마다 다시 그리지 않게 요소에 바로 넣는다
  function moveBy(distance: number) {
    sheet.current!.style.setProperty('--drag', `${distance}px`)
  }

  function stop() {
    startY.current = undefined
    sheet.current!.removeAttribute('data-dragging')
    moveBy(0)
  }

  /** 끄는 중이 아니면 없다. 두 번째 손가락은 보지 않는다. */
  function distanceOf(event: PointerEvent) {
    if (startY.current === undefined || !event.isPrimary) return undefined
    return Math.max(0, event.clientY - startY.current)
  }

  return {
    onPointerDown(event: PointerEvent) {
      const onButton = (event.target as Element).closest('button') !== null
      if (!event.isPrimary || event.button !== 0 || onButton) return
      event.currentTarget.setPointerCapture(event.pointerId)
      startY.current = event.clientY
      sheet.current!.setAttribute('data-dragging', '')
    },
    onPointerMove(event: PointerEvent) {
      const distance = distanceOf(event)
      if (distance !== undefined) moveBy(distance)
    },
    onPointerUp(event: PointerEvent) {
      const distance = distanceOf(event)
      if (distance === undefined) return
      stop()
      if (distance > sheet.current!.offsetHeight * CLOSE_RATIO) onClose()
    },
    onPointerCancel(event: PointerEvent) {
      if (distanceOf(event) !== undefined) stop()
    },
  }
}
