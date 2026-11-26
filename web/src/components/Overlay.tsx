import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { afterPressGuard, ignorePresses, usePressShield } from './pressGuard'
import styles from './Overlay.module.css'

type LayerProps = {
  /** 뒤 화면을 가린다. */
  scrim?: boolean
  /** 바깥을 누르거나 Esc를 누르면 부른다. */
  onClose: () => void
  /** 층 위에 놓는 면 하나 */
  children: ReactNode
} & ({ 'aria-label': string } | { 'aria-labelledby': string })

/**
 * 화면 전체를 덮는 모달 층. 초점을 가두는 것, 뒤 화면을 쓸 수 없게 하는 것, 맨 위에 그리는 것,
 * 연 곳으로 초점을 돌리는 것은 브라우저가 한다.
 */
export default function Overlay({ open, ...layer }: LayerProps & { open: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  const shown = useClosing(open, ref)
  usePressShield(open)
  return shown ? <Layer {...layer} ref={ref} closing={!open} /> : null
}

/** 닫히는 움직임이 끝나면 층을 뺀다. */
function useClosing(open: boolean, layer: RefObject<HTMLDialogElement | null>): boolean {
  const [shown, setShown] = useState(open)
  if (open && !shown) setShown(true)
  const closing = !open && shown

  useEffect(() => {
    if (!closing) return
    let reopened = false
    const motions = layer.current!.firstElementChild!.getAnimations().map(({ finished }) => finished)
    void Promise.allSettled(motions).then(() => {
      if (!reopened) setShown(false)
    })
    return () => {
      reopened = true
    }
  }, [closing, layer])

  return shown
}

function Layer({
  ref,
  closing,
  scrim = false,
  onClose,
  children,
  ...name
}: LayerProps & { ref: RefObject<HTMLDialogElement | null>; closing: boolean }) {
  const pressedOutside = useRef(false)
  const [forcedCloses, setForcedCloses] = useState(0)

  useLayoutEffect(() => {
    const dialog = ref.current!
    // 자리를 차지하던 스크롤 막대가 없어져도 뒤 화면이 옆으로 움직이지 않게 한다
    dialog.toggleAttribute('data-scrollbar', window.innerWidth > document.documentElement.clientWidth)
    dialog.setAttribute('data-opening', '')
    const cancelOpening = afterPressGuard(() => dialog.removeAttribute('data-opening'))
    const stopIgnoring = ignorePresses(dialog, () => isGuarded(dialog))
    dialog.showModal()
    return () => {
      cancelOpening()
      stopIgnoring()
      // 화면에서 빠지기 전에 닫아야 브라우저가 연 곳으로 초점을 돌린다
      dialog.close()
    }
  }, [ref])

  useLayoutEffect(() => {
    if (!closing && !ref.current!.open) ref.current!.showModal()
  }, [ref, closing, forcedCloses])

  return (
    <dialog
      {...name}
      ref={ref}
      aria-modal="true"
      data-closing={closing || undefined}
      className={scrim ? `${styles.overlay} ${styles.scrim}` : styles.overlay}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      // 브라우저가 cancel을 막지 못하게 하고 닫을 때가 있다. 부르는 쪽이 그대로 열어 두면 다시 연다.
      // 개발 모드에서 다시 연 뒤에 오는 알림은 거른다
      onClose={(event) => {
        if (event.currentTarget.open) return
        onClose()
        setForcedCloses((count) => count + 1)
      }}
      // 면을 누른 것은 면의 요소로 온다. 이 요소로 온 것은 바깥이다. 안에서 눌러 밖에서 뗀 것은 거른다
      onPointerDown={(event) => {
        pressedOutside.current = event.target === event.currentTarget && !isGuarded(event.currentTarget)
      }}
      onClick={(event) => {
        if (pressedOutside.current && event.target === event.currentTarget) onClose()
      }}
    >
      {children}
    </dialog>
  )
}

/** 막 열었거나 닫는 중이다. 이때는 면을 누른 것도 층으로 온다. */
function isGuarded(layer: HTMLElement): boolean {
  return layer.hasAttribute('data-opening') || layer.hasAttribute('data-closing')
}
