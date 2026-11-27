import { useId, type ReactNode } from 'react'
import Overlay from './Overlay'
import styles from './CenterDialog.module.css'

interface CenterDialogProps {
  open: boolean
  title: string
  /** 안의 내용이 제목에 초점을 줄 수 있게 한다(tabindex=-1, 탭 순서에는 없다). 00-common 5.4 */
  titleFocusable?: boolean
  onClose: () => void
  children: ReactNode
}

/** 넓은 화면의 가운데 창(화면설계서 00-common 5.4). 초점은 안의 내용이 useEffect에서 옮긴다. */
export default function CenterDialog({ open, title, titleFocusable = false, onClose, children }: CenterDialogProps) {
  const titleId = useId()
  return (
    <Overlay open={open} aria-labelledby={titleId} scrim onClose={onClose}>
      <div className={styles.window}>
        <h2 id={titleId} className={styles.title} tabIndex={titleFocusable ? -1 : undefined}>
          {title}
        </h2>
        {children}
      </div>
    </Overlay>
  )
}
