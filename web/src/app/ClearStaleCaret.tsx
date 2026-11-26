import { useLayoutEffect } from 'react'
import { useLocation } from 'react-router'

/**
 * 화면이 바뀌면 앞 화면에 두고 온 커서(접힌 선택)를 지운다(#249).
 *
 * 초점이 있던 입력칸이 앞 화면과 함께 빠지면 문서의 선택은 DOM 규칙대로 그 화면이 있던 자리, 곧 공통 틀 내용 영역의 맨 앞으로
 * 옮겨 남는다. 돌아온 화면에서 그 자리는 상단 바(sticky)의 첫 글자다. 커서를 옮긴 일(초점, 입력)의 한두 프레임 안에 화면이
 * 바뀌면 WebKit은 위치를 되살린 다음 그리기에서 남은 커서를 scroll-padding(상단 바) 아래로 드러내려고 화면을 올린다
 * (휴대폰 배치에서 43px). 상단 바가 없는 넓은 화면에서는 커서가 내용 맨 앞(화면 밖 위)이라 맨 위까지 올린다.
 * Chromium은 올리지 않는다.
 *
 * 위치를 되살리는 ScrollPosition(안의 ScrollRestoration)보다 앞에 두어 그보다 먼저 지운다. 새 화면이 입력칸에 초점을 주는 것
 * (autoFocus, layout effect)은 이보다 뒤에 돈다. 초점이 입력칸에 있으면 쓰는 중인 커서이고, 접히지 않은 선택은 사용자가 고른
 * 글이라 남긴다.
 */
export default function ClearStaleCaret() {
  const { key } = useLocation()
  useLayoutEffect(() => {
    const selection = document.getSelection()
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return
    if (isTyping(document.activeElement)) return
    selection.removeAllRanges()
  }, [key])
  return null
}

function isTyping(element: Element | null): boolean {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLElement && element.isContentEditable)
  )
}
