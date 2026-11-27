import { useLayoutEffect } from 'react'
import { ScrollRestoration, useLocation } from 'react-router'
import { takeStartAtTop } from '../components/startAtTop'

/**
 * 화면을 옮길 때 창의 스크롤 위치. 새 화면은 맨 위에서, 뒤로 가기로 돌아온 화면은 앞서 보던 위치에서 시작한다
 * (00-common 4.5, react-router의 ScrollRestoration). 저장에 성공해 돌아온 화면만 맨 위에서 시작한다(#245, startAtTop).
 * 자식의 layout effect가 먼저 돌므로, ScrollRestoration이 앞 위치로 옮긴 뒤 칠하기 전에 맨 위로 다시 옮긴다.
 */
export default function ScrollPosition() {
  const { key } = useLocation()

  useLayoutEffect(() => {
    if (takeStartAtTop()) window.scrollTo(0, 0)
  }, [key])

  return <ScrollRestoration />
}
