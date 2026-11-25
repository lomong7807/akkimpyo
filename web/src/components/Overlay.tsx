import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import styles from './Overlay.module.css'

/**
 * 열거나 닫은 뒤 손가락과 마우스를 받지 않는 시간. 휴대폰의 두 번 두드리기 간격이 대개 이 안이다.
 * 칸을 두 번 누르면 둘째 누름이 막 열린 가림막이나 달력에 닿고, 날짜를 두 번 누르면 층이 사라진 뒤 화면에 닿는다.
 * 움직임이 없거나 줄인 때에도 같다. Esc와 키보드는 바로 받는다.
 */
const PRESS_GUARD_MS = 300

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
  const { shown, shielding } = useClosing(open, ref)
  if (shown) return <Layer {...layer} ref={ref} closing={!open} />
  return shielding ? <div ref={ignorePresses} className={styles.shield} /> : null
}

/** 닫히는 움직임이 끝나면 층을 빼고, 닫은 때부터 누름을 막는 시간이 지날 때까지 뒤 화면을 덮는다. */
function useClosing(open: boolean, layer: RefObject<HTMLDialogElement | null>) {
  const [shown, setShown] = useState(open)
  const [shielding, setShielding] = useState(open)
  if (open && !shown) setShown(true)
  if (open && !shielding) setShielding(true)
  const closing = !open && (shown || shielding)

  useEffect(() => {
    if (!closing) return
    let reopened = false
    const motions = layer.current!.firstElementChild!.getAnimations().map(({ finished }) => finished)
    void Promise.allSettled(motions).then(() => {
      if (!reopened) setShown(false)
    })
    const cancelShield = afterPressGuard(() => setShielding(false))
    return () => {
      reopened = true
      cancelShield()
    }
  }, [closing, layer])

  return { shown, shielding }
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
      // 브라우저가 cancel을 막지 못하게 하고 닫을 때가 있다. 개발 모드에서 다시 연 뒤에 오는 알림은 거른다
      onClose={(event) => {
        if (!event.currentTarget.open) onClose()
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

/**
 * 이 요소에서 시작한 누르기를 없던 것으로 한다. 초점도 옮기지 않는다.
 * 손가락은 떼는 자리의 것을 누른 것이 되므로 시작할 때 막아야 한다. 리액트는 그때 막을 수 없게 듣는다.
 */
function ignorePresses(element: HTMLElement | null, active = () => true) {
  function ignore(event: Event) {
    if (active()) event.preventDefault()
  }
  element?.addEventListener('touchstart', ignore)
  element?.addEventListener('mousedown', ignore)
  return () => {
    element?.removeEventListener('touchstart', ignore)
    element?.removeEventListener('mousedown', ignore)
  }
}

/** 지금 바뀐 것이 화면에 나온 때부터 누름을 막는 시간이 지나면 부른다. */
function afterPressGuard(callback: () => void) {
  let timer: number | undefined
  const frame = requestAnimationFrame(() => {
    timer = window.setTimeout(callback, PRESS_GUARD_MS)
  })
  return () => {
    cancelAnimationFrame(frame)
    window.clearTimeout(timer)
  }
}
