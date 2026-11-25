import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { afterModals } from '../components/openModal'
import { ToastContext } from '../components/ToastContext'
import styles from './ToastProvider.module.css'

/** 보이는 시간 */
const DURATION_MS = 4000

/** 토스트 높이에서 이만큼보다 많이 아래로 밀면 닫는다. 바닥 시트와 같다. */
const CLOSE_RATIO = 1 / 4

/**
 * 토스트(화면설계서 00-common 5.7). 한 번에 하나만 보인다.
 * 알림 영역은 화면이 바뀌어도 그대로 두고, 로그인이 끝나면 이 공급자를 버려 앞 사용자의 이름이 남지 않게 한다.
 */
export default function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string }>()
  const cancelWaiting = useRef(() => {})

  // 모달은 화면 전체를 덮고 그 밖은 읽히지 않으므로, 닫힌 뒤에 알린다
  const showToast = useCallback((message: string) => {
    cancelWaiting.current()
    cancelWaiting.current = afterModals(() => setToast((last) => ({ id: (last?.id ?? 0) + 1, message })))
  }, [])
  useEffect(() => () => cancelWaiting.current(), [])

  const removeToast = useCallback(() => setToast(undefined), [])

  return (
    <ToastContext value={showToast}>
      {children}
      <div role="status" className={styles.region}>
        {toast && <Toast key={toast.id} message={toast.message} onClosed={removeToast} />}
      </div>
    </ToastContext>
  )
}

function Toast({ message, onClosed }: { message: string; onClosed: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [closing, setClosing] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const remaining = useRef(DURATION_MS)
  const paused = hovered || focused
  const swipeHandlers = useSwipeDown(() => setClosing(true))

  useEffect(() => {
    if (paused || closing) return
    const startedAt = performance.now()
    const timer = setTimeout(() => setClosing(true), remaining.current)
    return () => {
      clearTimeout(timer)
      remaining.current -= performance.now() - startedAt
    }
  }, [paused, closing])

  useEffect(() => {
    if (!closing) return
    let replaced = false
    const motions = ref.current!.getAnimations().map(({ finished }) => finished)
    void Promise.allSettled(motions).then(() => {
      if (!replaced) onClosed()
    })
    return () => {
      replaced = true
    }
  }, [closing, onClosed])

  return (
    <div
      ref={ref}
      data-closing={closing || undefined}
      className={styles.toast}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      {...swipeHandlers}
    >
      <p className={styles.message}>{message}</p>
    </div>
  )
}

/** 아래로 밀면 부른다. 두 번째 손가락은 보지 않는다. */
function useSwipeDown(onSwipe: () => void) {
  const startY = useRef<number>(undefined)

  function stop() {
    startY.current = undefined
  }

  return {
    onPointerDown(event: PointerEvent) {
      if (!event.isPrimary || event.button !== 0) return
      event.currentTarget.setPointerCapture(event.pointerId)
      startY.current = event.clientY
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      if (startY.current === undefined || !event.isPrimary) return
      if (event.clientY - startY.current <= event.currentTarget.offsetHeight * CLOSE_RATIO) return
      stop()
      onSwipe()
    },
    onPointerUp: stop,
    onPointerCancel: stop,
  }
}
