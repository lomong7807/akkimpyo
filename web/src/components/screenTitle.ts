/** 하위 화면 제목(h1)의 id(components/Screen의 TitleBar) */
export const SCREEN_TITLE_ID = 'screen-title'

/**
 * 하위 화면의 제목(h1)으로 초점을 옮긴다. 누른 버튼이 화면에서 없어져 초점이 갈 곳이 없을 때 쓴다(B-05에서 마지막 입력을
 * 버림, designer #236). 하위 화면이 아니면 아무 일도 없다.
 */
export function focusScreenTitle(): void {
  document.getElementById(SCREEN_TITLE_ID)?.focus()
}
