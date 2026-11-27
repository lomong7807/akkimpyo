import { useEffect } from 'react'
import { onConnectionChange } from '../api/connection'
import LoadFailureHere from '../features/connection/LoadFailureHere'

/**
 * 화면 코드가 예외를 던졌을 때 내용 자리에 보인다. 예외의 글자는 보이지 않는다. 연결이 없으면 버튼 없이
 * "연결되면 자동으로 불러올게요."이고, 연결이 돌아오면 저절로 새로고침한다(F-908, #238).
 */
export default function ScreenError() {
  useEffect(
    () =>
      onConnectionChange((next) => {
        if (next === 'online') window.location.reload()
      }),
    [],
  )
  return <LoadFailureHere onRetry={() => window.location.reload()} />
}
