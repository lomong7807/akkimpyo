import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { afterModals } from '../components/openModal'
import { ToastContext, type ToastAction } from '../components/ToastContext'
import { useScreenHandle } from './useScreenHandle'
import styles from './ToastProvider.module.css'

/** 보이는 시간 */
const DURATION_MS = 4000

/** 되돌리기처럼 누를 버튼이 있는 토스트가 보이는 시간 */
const ACTION_DURATION_MS = 8000

/** 토스트 높이에서 이만큼보다 많이 아래로 밀면 닫는다. 바닥 시트와 같다. */
const CLOSE_RATIO = 1 / 4

interface ShownToast {
  id: number
  message: string
  action?: ToastAction
}

/**
 * 토스트(화면설계서 00-common 5.7). 한 번에 하나만 보인다.
 * 알림 영역은 화면이 바뀌어도 그대로 두고, 로그인이 끝나면 이 공급자를 버려 앞 사용자의 이름이 남지 않게 한다.
 */
export default function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ShownToast>()

  // 전체 화면 입력에서는 토스트의 자리(5.7)가 저장 버튼과 겹치므로, 열 때 보이던 것을 바로 걷는다.
  // 그 화면에서 알린 것(저장을 마침)은 두어 나간 화면에서 보이게 한다.
  // 되돌리기가 있는 토스트는 걷지 않고 저장 자리 위로 옮겨 시간이 다 될 때까지 남긴다(designer 결정 2026-11-26, #102)
  const formPath = useFullScreenPath()
  const [openedForm, setOpenedForm] = useState(formPath)
  if (formPath !== openedForm) {
    setOpenedForm(formPath)
    if (formPath !== undefined && !toast?.action) setToast(undefined)
  }

  // 모달은 화면 전체를 덮고 그 밖은 읽히지 않으므로, 닫힌 뒤에 알린다
  const showToast = useCallback((message: string, action?: ToastAction) => {
    afterModals(() => setToast((last) => ({ id: (last?.id ?? 0) + 1, message, action })))
  }, [])

  const removeToast = useCallback(() => setToast(undefined), [])

  return (
    <ToastContext value={showToast}>
      {children}
      <div role="status" className={styles.region} data-above-form={formPath !== undefined || undefined}>
        {toast && <Toast key={toast.id} message={toast.message} action={toast.action} onClosed={removeToast} />}
      </div>
    </ToastContext>
  )
}

/** 전체 화면 입력(라우트의 handle에 fullScreen)의 주소. 아니면 없다. */
function useFullScreenPath(): string | undefined {
  const { fullScreen } = useScreenHandle()
  const { pathname } = useLocation()
  return fullScreen ? pathname : undefined
}

interface ToastProps {
  message: string
  action: ToastAction | undefined
  onClosed: () => void
}

function Toast({ message, action, onClosed }: ToastProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [closing, setClosing] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const remaining = useRef(action ? ACTION_DURATION_MS : DURATION_MS)
  const paused = hovered || focused
  const swipeHandlers = useSwipeDown(() => setClosing(true))

  useEffect(() => {
    if (paused) return
    const startedAt = performance.now()
    const timer = setTimeout(() => setClosing(true), remaining.current)
    return () => {
      clearTimeout(timer)
      remaining.current -= performance.now() - startedAt
    }
  }, [paused])

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
      {action && (
        <button
          type="button"
          className={styles.action}
          onClick={(event) => {
            // 움직임 없이 바로 걷는다. 동작의 결과는 새 토스트가 알린다
            onClosed()
            // 키보드로 누른 click은 detail이 0이다
            focusScreenTitle(event.detail === 0)
            action.onAction()
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

/**
 * 누른 버튼이 사라지므로 초점을 지금 화면의 제목(h1)으로 옮겨 다음 Tab이 화면의 처음부터 이어지게 한다
 * (designer 검토 2026-11-26). 키보드로 눌렀을 때만 초점 테두리를 보인다.
 */
function focusScreenTitle(keyboard: boolean) {
  const title = document.querySelector<HTMLElement>('h1')
  if (!title) return
  if (!title.hasAttribute('tabindex')) title.tabIndex = -1
  title.focus({ focusVisible: keyboard })
}

/** 아래로 밀면 부른다. 두 번째 손가락은 보지 않는다. */
function useSwipeDown(onSwipe: () => void) {
  const startY = useRef<number>(undefined)

  function stop() {
    startY.current = undefined
  }

  return {
    onPointerDown(event: PointerEvent) {
      // 버튼에서 시작한 누름을 붙들면 click이 토스트로 가 버튼이 눌리지 않는다
      const onButton = (event.target as Element).closest('button') !== null
      if (!event.isPrimary || event.button !== 0 || onButton) return
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
