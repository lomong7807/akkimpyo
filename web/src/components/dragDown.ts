import { useRef, type PointerEvent, type RefObject } from 'react'

/** 끄는 면의 높이에서 이만큼보다 많이 끌어내리고 놓으면 닫는다. */
const CLOSE_RATIO = 1 / 4

/**
 * 머리를 아래로 끌면 면(`sheet`)이 따라 내려온다(바닥 시트 00-common 5.4, 전체 화면 입력 D-05 (1)). 끄는 동안 면에 `--drag`와
 * `data-dragging`을 단다. 돌려주는 것을 머리에 건다. 머리의 버튼에서 시작한 누름은 끌기가 아니다.
 */
export function useDragDown(sheet: RefObject<HTMLElement | null>, onClose: () => void) {
  const startY = useRef<number>(undefined)

  // 손가락을 따라가는 값이라 CSS에 적어 둘 수 없다. 끌 때마다 다시 그리지 않게 요소에 바로 넣는다
  function moveBy(distance: number) {
    sheet.current!.style.setProperty('--drag', `${distance}px`)
  }

  function stop() {
    startY.current = undefined
    sheet.current!.removeAttribute('data-dragging')
    moveBy(0)
  }

  /** 끄는 중이 아니면 없다. 두 번째 손가락은 보지 않는다. */
  function distanceOf(event: PointerEvent) {
    if (startY.current === undefined || !event.isPrimary) return undefined
    return Math.max(0, event.clientY - startY.current)
  }

  return {
    onPointerDown(event: PointerEvent) {
      const onButton = (event.target as Element).closest('button') !== null
      if (!event.isPrimary || event.button !== 0 || onButton) return
      event.currentTarget.setPointerCapture(event.pointerId)
      startY.current = event.clientY
      sheet.current!.setAttribute('data-dragging', '')
    },
    onPointerMove(event: PointerEvent) {
      const distance = distanceOf(event)
      if (distance !== undefined) moveBy(distance)
    },
    onPointerUp(event: PointerEvent) {
      const distance = distanceOf(event)
      if (distance === undefined) return
      stop()
      if (distance > sheet.current!.offsetHeight * CLOSE_RATIO) onClose()
    },
    onPointerCancel(event: PointerEvent) {
      if (distanceOf(event) !== undefined) stop()
    },
  }
}
