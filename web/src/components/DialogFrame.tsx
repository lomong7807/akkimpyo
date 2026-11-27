import type { ReactNode } from 'react'
import BottomSheet from './BottomSheet'
import CenterDialog from './CenterDialog'
import { useWideScreen } from './wideScreen'
import styles from './DialogFrame.module.css'

interface DialogFrameProps {
  open: boolean
  title: string
  /** 안에서 처리 중. X, 가림막, Esc, 끌어내리기, 브라우저가 강제로 닫은 것을 모두 무시한다(5.6). */
  busy?: boolean
  /** 안의 내용이 제목에 초점을 줄 수 있게 한다. 비교가 있어 길어지는 판이 처음 초점을 제목에 둔다(designer #239) */
  titleFocusable?: boolean
  onClose: () => void
  children: ReactNode
}

/**
 * 확인 창과 판의 틀(화면설계서 00-common 5.4, 5.6, 와이어프레임 공통 배치 규칙 9). 휴대폰 배치는 바닥 시트, 넓은 화면은
 * 가운데 창이다. 한 틀 안에서 내용만 바꾸면 창을 다시 열지 않고 그 자리에서 바뀐다(삭제 확인이 충돌 판이 될 때).
 * 초점은 안의 내용이 useEffect에서 옮긴다.
 */
export default function DialogFrame({
  open,
  title,
  busy = false,
  titleFocusable = false,
  onClose,
  children,
}: DialogFrameProps) {
  const wide = useWideScreen()
  // 강제로 닫혔으면 Overlay가 다시 연다
  const close = busy ? ignore : onClose
  if (wide) {
    return (
      <CenterDialog open={open} title={title} titleFocusable={titleFocusable} onClose={close}>
        {children}
      </CenterDialog>
    )
  }
  return (
    <BottomSheet open={open} title={title} closeDisabled={busy} titleFocusable={titleFocusable} onClose={close}>
      <div className={styles.inSheet}>{children}</div>
    </BottomSheet>
  )
}

function ignore() {}
