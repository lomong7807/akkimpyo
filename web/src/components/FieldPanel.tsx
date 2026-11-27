import { useLayoutEffect, useRef, type ReactNode } from 'react'
import Overlay from './Overlay'
import styles from './FieldPanel.module.css'

interface FieldPanelProps {
  open: boolean
  /** 판을 연 칸의 이름 */
  label: string
  /** 판을 붙일 칸 */
  anchor: HTMLElement
  /**
   * - calendar: 날짜 고르기. 폭 320px이고 최대 높이가 없다(화면설계서 00-common 5.8)
   * - list: 고르기 목록. 폭은 칸 폭과 320px 중 큰 값, 최대 높이 360px이다(5.4)
   */
  kind?: 'calendar' | 'list'
  onClose: () => void
  children: ReactNode
}

/** 넓은 화면에서 칸 아래에 펼치는 판(화면설계서 00-common 5.4). 초점은 안의 내용이 useEffect에서 옮긴다. */
export default function FieldPanel({ open, label, anchor, kind = 'calendar', onClose, children }: FieldPanelProps) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open) return
    const panel = ref.current!

    // 칸의 자리와 남은 높이는 화면마다 달라 CSS에 적어 둘 수 없다
    function place() {
      const field = anchor.getBoundingClientRect()
      panel.style.setProperty('--field-left', `${field.left}px`)
      panel.style.setProperty('--field-top', `${field.top}px`)
      panel.style.setProperty('--field-bottom', `${field.bottom}px`)
      panel.style.setProperty('--field-width', `${field.width}px`)
      // 남은 자리와 상관없이 보여야 할 높이. 목록은 최대 높이에서 잘리는 것이 정해진 모양이다
      let needed = panel.scrollHeight
      if (kind === 'list') {
        panel.dataset.side = 'measure'
        needed = panel.clientHeight
      }
      panel.dataset.side = 'below'
      const cutOff = panel.clientHeight < needed
      if (cutOff && field.top > window.innerHeight - field.bottom) panel.dataset.side = 'above'
    }

    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, anchor, kind])

  return (
    <Overlay open={open} aria-label={label} onClose={onClose}>
      <div ref={ref} className={kind === 'list' ? `${styles.panel} ${styles.list}` : styles.panel}>
        {children}
      </div>
    </Overlay>
  )
}
