/*
 * 화면에 보이는 영역(visualViewport). 브라우저는 화면 키보드가 올라와도 화면 높이(dvh)를 줄이지 않으므로 이것으로 키보드를 안다.
 * 보이는 영역을 읽는 곳은 여기 하나다(전체 화면 입력의 저장 자리, 공통 틀의 하단 탭, architect #233 A7).
 */

export interface VisibleArea {
  /** 문서 맨 위에서 보이는 영역 맨 위까지 */
  top: number
  height: number
  /** 보이는 영역 아래의 틈. 화면 키보드가 차지한 높이다 */
  keyboard: number
}

/** 지금 보이는 영역. 두 손가락으로 확대해 보는 중이거나 알 수 없으면 없다(확대는 키보드가 아니다) */
export function visibleArea(): VisibleArea | undefined {
  const viewport = window.visualViewport
  if (!viewport || Math.round(viewport.scale * 100) !== 100) return undefined
  const { offsetTop: top, height } = viewport
  return { top, height, keyboard: Math.max(0, document.documentElement.clientHeight - top - height) }
}

/** 화면 키보드가 올라왔다고 볼 틈. 키보드 위의 도구 막대만 있는 경우(외부 키보드)는 넣지 않는다 */
const KEYBOARD_MIN = 150

/** 글을 쓰는 칸에 초점이 있고 보이는 영역 아래에 키보드만큼의 틈이 있다 */
export function keyboardShown(): boolean {
  const keyboard = visibleArea()?.keyboard ?? 0
  return keyboard >= KEYBOARD_MIN && isWriting(document.activeElement)
}

/** 화면 키보드를 올리는 칸의 종류 */
const writingTypes = new Set(['text', 'search', 'email', 'password', 'tel', 'url', 'number'])

function isWriting(element: Element | null): boolean {
  if (element instanceof HTMLTextAreaElement) return !element.readOnly
  return element instanceof HTMLInputElement && !element.readOnly && writingTypes.has(element.type)
}

/**
 * 보이는 영역이 바뀌거나 초점이 칸으로 오면 부른다. 칸을 떠나 키보드가 내려가면 보이는 영역이 바뀐다. 칸 사이를 옮기는 동안
 * (초점이 잠깐 문서로 가는 사이) 하단 탭이 깜빡이지 않게 초점이 떠나는 것은 듣지 않는다. 그만 들으려면 돌려준 함수를 부른다
 */
export function onKeyboardChange(listener: () => void): () => void {
  const viewport = window.visualViewport
  viewport?.addEventListener('resize', listener)
  document.addEventListener('focusin', listener)
  return () => {
    viewport?.removeEventListener('resize', listener)
    document.removeEventListener('focusin', listener)
  }
}
