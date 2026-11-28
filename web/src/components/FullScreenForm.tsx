import {
  use,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  type SubmitEvent,
} from 'react'
import { Button } from './Button'
import ConfirmDialog from './ConfirmDialog'
import { useDragDown } from './dragDown'
import { X } from './icons'
import { keepFocusInField } from './keepFocusInField'
import layout from './layout.module.css'
import { isModalOpen } from './openModal'
import { usePressShield } from './pressGuard'
import { shellRiseElapsed, ShellShownContext } from './shellShown'
import { InPaneContext } from './sidePane'
import { ShellContext } from './ShellContext'
import type { LeaveGuard } from './useLeaveGuard'
import { visibleArea } from './visibleArea'
import styles from './FullScreenForm.module.css'

interface FullScreenFormProps {
  title: string
  /** 떠나는 길. useLeaveGuard가 준다. 주소가 없는 입력(D-05)은 묻지 않고 닫는 길을 준다 */
  guard: Pick<LeaveGuard, 'busy' | 'asking' | 'close' | 'keep' | 'discard'>
  onSubmit: () => void
  /** 맨 아래에 고정하는 저장 버튼과 그 위의 문구. 없으면 저장 자리를 숨긴다(수정할 거래를 받는 동안, D-04 상태). */
  bottom?: ReactNode
  /** 화면 이름 아래의 안내 한 줄(D-04 상태의 "열린 경로별 안내", 보조 글자색). 칸 맨 위에 둔다 */
  notice?: string
  /** 안내를 위험색 글자로 보인다(D-04 (33) "보내지 못한 이유", designer #237 D9). 자리와 글자는 같다 */
  noticeDanger?: boolean
  /** Ctrl+엔터(Mac은 Cmd+엔터)를 어느 칸에서나 저장으로 받는다(D-04 (16)). 한글을 조합하는 중과 판이 열린 동안은 받지 않는다. */
  submitShortcut?: boolean
  /** 머리를 아래로 끌어내리면 닫는다(guard.close, D-05 (1)) */
  dragToClose?: boolean
  children: ReactNode
}

/**
 * 전체 화면 입력(화면설계서 00-common 5.5). 모달이 아니라 화면이다.
 * 라우트의 handle에 fullScreen을 적어 하단 탭을 없앤다.
 * 넓은 화면에서 목록 옆 오른쪽 칸에 열면(InPaneContext) 칸 높이를 채우는 영역이다. 제목은 칸의 제목(h2)이고 "닫기"는 머리 왼쪽,
 * 저장 자리는 칸 맨 아래다. 화면 전체의 영역(main)과 연결 없음 띠는 목록 쪽의 것을 쓴다(D-04·G-02 넓은 화면, #244).
 */
export default function FullScreenForm({
  title,
  guard,
  onSubmit,
  bottom,
  notice,
  noticeDanger = false,
  submitShortcut = false,
  dragToClose = false,
  children,
}: FullScreenFormProps) {
  const screen = useRef<HTMLDivElement>(null)
  const bottomArea = useRef<HTMLDivElement>(null)
  const inPane = use(InPaneContext)
  const titleId = useId()
  const drag = useDragDown(screen, guard.close)
  // 연결 없음 띠는 머리 바로 아래(00-common 6.1). 동기화 상태 표시(B-04)는 전체 화면 입력에 없다
  const { band } = use(ShellContext)
  useVisibleArea(screen, bottomArea)
  useRiseAfterShell(screen)
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

  // 오른쪽 칸은 칸의 폭을 그대로 쓴다
  const width = inPane ? '' : `${layout.contentWidth} ${layout.fullScreenForm} `
  const Title = inPane ? 'h2' : 'h1'
  const Main = inPane ? 'div' : 'main'
  return (
    <div
      ref={screen}
      className={inPane ? `${styles.screen} ${styles.inPane}` : styles.screen}
      {...(inPane && { role: 'region', 'aria-labelledby': titleId })}
      aria-busy={guard.busy || undefined}
      onMouseDown={keepFocusInField}
    >
      <header className={`${width}${styles.head}${dragToClose ? ` ${styles.dragHandle}` : ''}`} {...(dragToClose && drag)}>
        <div className={styles.close}>
          <Button kind="icon" icon={X} aria-label="닫기" onClick={guard.close} />
        </div>
        <Title id={titleId} className={styles.title}>
          {title}
        </Title>
      </header>
      {!inPane && band}
      <Main className={styles.main}>
        <form className={styles.form} noValidate onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
          <div className={`${width}${styles.fields}`}>
            {/* 초점은 옮기지 않는다. 비어 있을 때 자리를 차지하지 않게 있을 때만 그린다 */}
            {notice && (
              <p role="status" className={noticeDanger ? `${styles.notice} ${styles.noticeDanger}` : styles.notice}>
                {notice}
              </p>
            )}
            {children}
          </div>
          {/* 숨겨도 남겨 둔다. 저장 자리의 높이를 재는 곳이 이 요소를 지켜본다 */}
          <div
            ref={bottomArea}
            hidden={bottom === undefined}
            className={`${width}${styles.bottom}`}
          >
            {bottom}
          </div>
        </form>
      </Main>
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

/**
 * 화면 코드를 받는 동안 같은 자리에 틀(FullScreenFormShell)이 올라오고 있었으면, 처음부터 다시 올라오지 않고 틀이 올라온 데서
 * 이어 남은 만큼만 올라온다(#251). 틀이 다 올라왔으면 움직이지 않는다.
 */
function useRiseAfterShell(screen: RefObject<HTMLElement | null>) {
  const afterShell = use(ShellShownContext)
  useLayoutEffect(() => {
    const element = screen.current!
    if (afterShell) element.style.setProperty('animation-delay', `${-shellRiseElapsed()}ms`)
  }, [afterShell, screen])
}

/** 한글을 조합하는 중의 키. Safari는 조합이 끝났다고 먼저 알리므로 입력기가 받은 키(keyCode 229)도 본다. */
function isComposing(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229
}

/** 저장 자리의 윗선을 화면 아래에서 잰 거리. 토스트(ToastProvider)가 이 화면에 남으면 그 위 16px에 놓인다. */
const TOAST_ABOVE_FORM = '--toast-above-form'

/**
 * 화면 키보드가 올라오면 화면을 보이는 영역에 맞춘다. 브라우저는 키보드가 올라와도 화면 높이(dvh)를 줄이지 않는다.
 * 다른 화면의 배치까지 바꾸는 viewport의 interactive-widget은 쓰지 않는다.
 *
 * 되돌리기가 있는 토스트는 이 화면을 열어도 걷지 않고 저장 자리 위에 남는다(00-common 5.7, designer 결정 2026-11-26).
 * 토스트는 이 화면 밖에 있어 저장 자리의 윗선을 문서의 맨 위 요소에 알린다. 저장 자리는 화면 아래에 붙어 있으므로
 * 저장 자리의 높이에 보이는 영역 아래의 틈(화면 키보드)을 더해 센다. 화면이 올라오는 움직임(translate) 중에도 맞다.
 * 저장 자리의 높이는 오류 문구와 글자 크기에 따라 바뀌므로 크기가 바뀔 때마다 다시 잰다.
 */
function useVisibleArea(screen: RefObject<HTMLElement | null>, bottom: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const viewport = window.visualViewport
    const element = screen.current!
    const area = bottom.current!
    const root = document.documentElement

    function fit() {
      const visible = visibleArea()
      element.style.setProperty('--visible-top', visible ? `${visible.top}px` : null)
      element.style.setProperty('--visible-height', visible ? `${visible.height}px` : null)
      root.style.setProperty(TOAST_ABOVE_FORM, `${area.offsetHeight + (visible?.keyboard ?? 0)}px`)
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
    const observer = new ResizeObserver(fit)
    observer.observe(area)
    viewport?.addEventListener('resize', fitAndReveal)
    viewport?.addEventListener('scroll', fit)
    return () => {
      observer.disconnect()
      viewport?.removeEventListener('resize', fitAndReveal)
      viewport?.removeEventListener('scroll', fit)
      root.style.removeProperty(TOAST_ABOVE_FORM)
    }
  }, [screen, bottom])
}
