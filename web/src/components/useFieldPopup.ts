import { useEffect, useState, type KeyboardEvent } from 'react'
import { wideScreen } from './wideScreen'

/** 판을 연 때의 칸과 배치. 닫히는 동안에도 쓴다. */
interface Opened {
  button: HTMLButtonElement
  /** 열 때 초점 테두리를 보이는지. 브라우저에 따라 눌러서 열어도 보이므로 연 칸이 알려 준다. */
  focusVisible: boolean
  wide: boolean
}

export type FieldPopup = ReturnType<typeof useFieldPopup>

/**
 * 누르면 고르기 판을 여는 칸(날짜, 카테고리, 계좌)의 여닫기. 휴대폰 배치는 바닥 시트, 넓은 화면은 칸 아래 판을 연다
 * (화면설계서 00-common 5.4). 연 동안 배치가 바뀌면 닫는다. 그리는 것은 FieldPopup이 한다.
 */
export function useFieldPopup() {
  const [open, setOpen] = useState(false)
  const [opened, setOpened] = useState<Opened>()
  const close = () => setOpen(false)

  useEffect(() => {
    if (!open) return
    const wide = wideScreen()
    const closeOnChange = () => setOpen(false)
    wide.addEventListener('change', closeOnChange)
    return () => wide.removeEventListener('change', closeOnChange)
  }, [open])

  return {
    open,
    opened,
    close,
    /** 누른 칸에서 연다. */
    openFrom(button: HTMLButtonElement) {
      setOpen(true)
      setOpened({ button, focusVisible: button.matches(':focus-visible'), wide: wideScreen().matches })
      // Safari는 누른 버튼에 초점을 주지 않는다. 닫힐 때 이 칸으로 돌아오게 한다
      button.focus()
    },
    /** 고른 키를 누르고 있으면 초점이 돌아온 칸에 되풀이해서 들어온다. 다시 열리지 않게 한다. */
    ignoreHeldKey(event: KeyboardEvent) {
      if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault()
    },
  }
}
