import { useEffect, useRef, useState } from 'react'
import BottomSheet from './BottomSheet'
import { Button } from './Button'
import CenterDialog from './CenterDialog'
import ErrorMessage from './ErrorMessage'
import { useWideScreen } from './wideScreen'
import styles from './ConfirmDialog.module.css'

/** 실행하지 못한 까닭. 실패할 때마다 새 객체로 준다. 같은 문구여도 다시 알리고 초점을 다시 옮긴다. */
export interface ConfirmFailure {
  /** 버튼 바로 위에 보일 문구(00-common 4.3) */
  message: string
  /** 초점을 옮길 버튼. 다시 누르면 되는 실패는 실행 버튼, 내용이 바뀌어 다시 볼 실패(충돌)는 "닫기"다. */
  focus: 'action' | 'close'
}

interface ConfirmDialogProps {
  open: boolean
  /** 묻는 말 */
  title: string
  /** 실행하면 어떻게 되는지 */
  description: string
  /** 왼쪽의 물러나는 버튼 */
  closeLabel: string
  /** 오른쪽의 지우거나 없애는 버튼. 동작 이름을 그대로 쓴다. 실패한 뒤의 글자("다시 시도" 등)도 화면이 준다. */
  actionLabel: string
  /** 실행 중. 실행 버튼에 도는 표시를 두고, 다른 버튼도 누를 수 없으며, 닫히지 않는다(5.6). */
  busy?: boolean
  failure?: ConfirmFailure
  onClose: () => void
  onAction: () => void
}

/** 확인 창(화면설계서 00-common 5.6). 휴대폰 배치는 바닥 시트, 넓은 화면은 가운데 창이다. */
export default function ConfirmDialog({ open, title, onClose, busy = false, ...question }: ConfirmDialogProps) {
  const wide = useWideScreen()
  const openings = useOpenings(open)
  // 처리 중에는 X, 가림막, Esc, 끌어내리기, 브라우저가 강제로 닫은 것을 모두 무시한다. 강제로 닫혔으면 Overlay가 다시 연다
  const close = busy ? ignore : onClose
  const content = <Question key={openings} {...question} busy={busy} onClose={close} />
  if (wide) {
    return (
      <CenterDialog open={open} title={title} onClose={close}>
        {content}
      </CenterDialog>
    )
  }
  return (
    <BottomSheet open={open} title={title} closeDisabled={busy} onClose={close}>
      <div className={styles.inSheet}>{content}</div>
    </BottomSheet>
  )
}

function ignore() {}

/** 연 횟수. 코드가 여는 창이라 닫히는 움직임 중에 다시 열릴 수 있다. 그때도 내용을 새로 시작한다. */
function useOpenings(open: boolean): number {
  const [last, setLast] = useState({ open: false, openings: 0 })
  if (open === last.open) return last.openings
  const openings = open ? last.openings + 1 : last.openings
  setLast({ open, openings })
  return openings
}

function Question({
  description,
  closeLabel,
  actionLabel,
  busy,
  failure,
  onClose,
  onAction,
}: Omit<ConfirmDialogProps, 'open' | 'title'>) {
  const closeButton = useRef<HTMLButtonElement>(null)
  const actionButton = useRef<HTMLButtonElement>(null)
  const failures = useChanges(failure)
  useEffect(() => closeButton.current!.focus(), [])

  // 실패마다 정한 버튼으로 초점을 옮긴다. 손가락이나 Safari의 마우스로 누른 버튼은 초점을 받지 않으므로 늘 옮긴다
  useEffect(() => {
    if (failure) (failure.focus === 'close' ? closeButton : actionButton).current!.focus()
  }, [failure])

  return (
    <>
      <p className={styles.description}>{description}</p>
      {failure && (
        <div key={failures} className={styles.failure}>
          <ErrorMessage role="alert">{failure.message}</ErrorMessage>
        </div>
      )}
      <div className={styles.actions}>
        <div>
          <Button ref={closeButton} kind="secondary" disabled={busy} onClick={onClose}>
            {closeLabel}
          </Button>
        </div>
        <div>
          <Button ref={actionButton} kind="danger" busy={busy} onClick={onAction}>
            {actionLabel}
          </Button>
        </div>
      </div>
    </>
  )
}

/** 값이 바뀐 횟수. 같은 문구의 실패가 이어져도 새로 그려 화면 읽기가 다시 알리게 한다. */
function useChanges<T>(value: T): number {
  const [last, setLast] = useState({ value, changes: 0 })
  if (Object.is(value, last.value)) return last.changes
  const changes = last.changes + 1
  setLast({ value, changes })
  return changes
}
