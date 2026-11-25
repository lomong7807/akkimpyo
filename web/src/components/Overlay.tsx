import { useLayoutEffect, useRef, type ReactNode } from 'react'
import styles from './Overlay.module.css'

type OverlayProps = {
  /** 뒤 화면을 가린다. */
  scrim?: boolean
  /** 바깥을 누르거나 Esc를 누르면 부른다. 부르는 쪽이 이 층을 화면에서 뺀다. */
  onClose: () => void
  children: ReactNode
} & ({ 'aria-label': string } | { 'aria-labelledby': string })

/**
 * 화면 전체를 덮는 모달 층. 그려지면 열리고 화면에서 빠지면 닫힌다.
 * 초점을 가두는 것, 뒤 화면을 쓸 수 없게 하는 것, 맨 위에 그리는 것, 연 곳으로 초점을 돌리는 것은 브라우저가 한다.
 */
export default function Overlay({ scrim = false, onClose, children, ...name }: OverlayProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const pressedOutside = useRef(false)

  useLayoutEffect(() => {
    const dialog = ref.current!
    // 자리를 차지하던 스크롤 막대가 없어져도 뒤 화면이 옆으로 움직이지 않게 한다
    dialog.toggleAttribute('data-scrollbar', window.innerWidth > document.documentElement.clientWidth)
    dialog.showModal()
    // 화면에서 빠지기 전에 닫아야 브라우저가 연 곳으로 초점을 돌린다
    return () => dialog.close()
  }, [])

  return (
    <dialog
      {...name}
      ref={ref}
      aria-modal="true"
      className={scrim ? `${styles.overlay} ${styles.scrim}` : styles.overlay}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      // 브라우저가 cancel을 막지 못하게 하고 닫을 때가 있다. 개발 모드에서 다시 연 뒤에 오는 알림은 거른다
      onClose={(event) => {
        if (!event.currentTarget.open) onClose()
      }}
      // 안의 것은 모두 안쪽 요소에 그려지므로 이 요소를 누른 것은 바깥이다. 안에서 눌러 밖에서 뗀 것은 거른다
      onPointerDown={(event) => {
        pressedOutside.current = event.target === event.currentTarget
      }}
      onClick={(event) => {
        if (pressedOutside.current && event.target === event.currentTarget) onClose()
      }}
    >
      {children}
    </dialog>
  )
}
