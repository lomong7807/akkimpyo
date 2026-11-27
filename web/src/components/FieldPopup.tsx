import type { ReactNode } from 'react'
import BottomSheet from './BottomSheet'
import FieldPanel from './FieldPanel'
import type { FieldPopup as Popup } from './useFieldPopup'

interface FieldPopupProps {
  popup: Popup
  /** 시트의 제목과 판의 이름. 연 칸의 이름이다. */
  title: string
  /** 넓은 화면의 판 모양 */
  kind: 'calendar' | 'list'
  /** 판 안의 내용. 시트와 판 가운데 열린 쪽에 하나만 그린다. */
  children: ReactNode
}

/** useFieldPopup으로 연 고르기 판. 연 때의 배치로 바닥 시트나 칸 아래 판을 그린다. */
export default function FieldPopup({ popup, title, kind, children }: FieldPopupProps) {
  const { open, opened, close } = popup
  return (
    <>
      <BottomSheet title={title} open={open && opened?.wide === false} onClose={close}>
        {children}
      </BottomSheet>
      {opened?.wide && (
        <FieldPanel open={open} label={title} anchor={opened.button} kind={kind} onClose={close}>
          {children}
        </FieldPanel>
      )}
    </>
  )
}
