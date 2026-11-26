import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  type SubmitEvent,
} from 'react'
import { Button } from './Button'
import ConfirmDialog from './ConfirmDialog'
import { keepFocusInField } from './keepFocusInField'
import layout from './layout.module.css'
import { isModalOpen } from './openModal'
import { usePressShield } from './pressGuard'
import type { LeaveGuard } from './useLeaveGuard'
import styles from './FullScreenForm.module.css'

interface FullScreenFormProps {
  title: string
  /** 떠나는 길. useLeaveGuard가 준다. */
  guard: LeaveGuard
  onSubmit: () => void
  /** 맨 아래에 고정하는 저장 버튼과 그 위의 문구 */
  bottom: ReactNode
  /** Ctrl+엔터(Mac은 Cmd+엔터)를 어느 칸에서나 저장으로 받는다(D-04 (16)). 한글을 조합하는 중과 판이 열린 동안은 받지 않는다. */
  submitShortcut?: boolean
  children: ReactNode
}

/**
 * 전체 화면 입력(화면설계서 00-common 5.5). 모달이 아니라 화면이다.
 * 라우트의 handle에 fullScreen을 적어 하단 탭을 없앤다.
 */
export default function FullScreenForm({
  title,
  guard,
  onSubmit,
  bottom,
  submitShortcut = false,
  children,
}: FullScreenFormProps) {
  const screen = useRef<HTMLDivElement>(null)
  useVisibleArea(screen)
  useEscape(guard.close)
  // 닫기는 앞 화면의 "뒤로", 저장은 하단 탭과 같은 자리다
  usePressShield(true)

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault()
    onSubmit()
  }

  function handleKeyDown(event: ReactKeyboardEvent) {
    if (!submitShortcut || event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return
    if (isComposing(event.nativeEvent) || event.repeat || isModalOpen()) return
    event.preventDefault()
    onSubmit()
  }

  return (
    <div
      ref={screen}
      className={styles.screen}
      aria-busy={guard.busy || undefined}
      onMouseDown={keepFocusInField}
    >
      <header className={`${layout.contentWidth} ${layout.fullScreenForm} ${styles.head}`}>
        <div className={styles.close}>
          <Button kind="icon" icon="X" aria-label="닫기" onClick={guard.close} />
        </div>
        <h1 className={styles.title}>{title}</h1>
      </header>
      <main className={styles.main}>
        <form className={styles.form} noValidate onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
          <div className={`${layout.contentWidth} ${layout.fullScreenForm} ${styles.fields}`}>{children}</div>
          <div className={`${layout.contentWidth} ${layout.fullScreenForm} ${styles.bottom}`}>{bottom}</div>
        </form>
      </main>
      <ConfirmDialog
        open={guard.asking}
        title="쓰던 내용을 버릴까요?"
        description="저장하지 않은 내용은 사라져요"
        closeLabel="계속 쓰기"
        actionLabel="버리기"
        onClose={guard.keep}
        onAction={guard.discard}
      />
    </div>
  )
}

/**
 * 한글을 조합하는 중의 Esc와 열린 모달을 닫는 Esc는 화면의 것이 아니다.
 * Safari는 조합이 끝났다고 먼저 알리고 그 keydown의 isComposing을 거짓으로 줄 수 있다. 입력기가 받은 키는 keyCode가 229다.
 */
function useEscape(onEscape: () => void) {
  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== 'Escape' || isComposing(event) || event.repeat || isModalOpen()) return
    // 그냥 두면 브라우저가 이 Esc로 막 연 확인 창을 닫는다
    event.preventDefault()
    onEscape()
  })

  useEffect(() => {
    const listen = (event: KeyboardEvent) => handleKeyDown(event)
    window.addEventListener('keydown', listen)
    return () => window.removeEventListener('keydown', listen)
  }, [])
}

/** 한글을 조합하는 중의 키. Safari는 조합이 끝났다고 먼저 알리므로 입력기가 받은 키(keyCode 229)도 본다. */
function isComposing(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229
}

/**
 * 화면 키보드가 올라오면 화면을 보이는 영역에 맞춘다. 브라우저는 키보드가 올라와도 화면 높이(dvh)를 줄이지 않는다.
 * 다른 화면의 배치까지 바꾸는 viewport의 interactive-widget은 쓰지 않는다.
 */
function useVisibleArea(screen: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const element = screen.current!

    function fit() {
      // 두 손가락으로 확대해 보는 것은 키보드가 아니다
      const zoomed = Math.round(viewport!.scale * 100) !== 100
      element.style.setProperty('--visible-top', zoomed ? null : `${viewport!.offsetTop}px`)
      element.style.setProperty('--visible-height', zoomed ? null : `${viewport!.height}px`)
    }

    function fitAndReveal() {
      fit()
      // 줄어들며 쓰던 칸이 저장 자리 뒤로 들어갔을 수 있다
      const focused = document.activeElement
      if (focused && focused !== document.body && element.contains(focused)) {
        focused.scrollIntoView({ block: 'nearest' })
      }
    }

    fit()
    viewport.addEventListener('resize', fitAndReveal)
    viewport.addEventListener('scroll', fit)
    return () => {
      viewport.removeEventListener('resize', fitAndReveal)
      viewport.removeEventListener('scroll', fit)
    }
  }, [screen])
}
