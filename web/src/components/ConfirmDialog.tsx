import { useEffect, useRef, useState } from 'react'
import BottomSheet from './BottomSheet'
import { Button } from './Button'
import CenterDialog from './CenterDialog'
import { useWideScreen } from './wideScreen'
import styles from './ConfirmDialog.module.css'

interface ConfirmDialogProps {
  open: boolean
  /** 묻는 말 */
  title: string
  /** 실행하면 어떻게 되는지 */
  description: string
  /** 왼쪽의 물러나는 버튼 */
  closeLabel: string
  /** 오른쪽의 지우거나 없애는 버튼. 동작 이름을 그대로 쓴다. */
  actionLabel: string
  onClose: () => void
  onAction: () => void
}

/** 확인 창(화면설계서 00-common 5.6). 휴대폰 배치는 바닥 시트, 넓은 화면은 가운데 창이다. */
export default function ConfirmDialog({ open, title, onClose, ...question }: ConfirmDialogProps) {
  const wide = useWideScreen()
  const openings = useOpenings(open)
  const content = <Question key={openings} {...question} onClose={onClose} />
  if (wide) {
    return (
      <CenterDialog open={open} title={title} onClose={onClose}>
        {content}
      </CenterDialog>
    )
  }
  return (
    <BottomSheet open={open} title={title} onClose={onClose}>
      <div className={styles.inSheet}>{content}</div>
    </BottomSheet>
  )
}

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
  onClose,
  onAction,
}: Omit<ConfirmDialogProps, 'open' | 'title'>) {
  const closeButton = useRef<HTMLButtonElement>(null)
  useEffect(() => closeButton.current!.focus(), [])
  return (
    <>
      <p className={styles.description}>{description}</p>
      <div className={styles.actions}>
        <div>
          <Button ref={closeButton} kind="secondary" onClick={onClose}>
            {closeLabel}
          </Button>
        </div>
        <div>
          <Button kind="danger" onClick={onAction}>
            {actionLabel}
          </Button>
        </div>
      </div>
    </>
  )
}
