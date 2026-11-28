import { useNavigate } from 'react-router'

/** 앞서 본 화면으로 돌아간다. 없으면(주소를 바로 연 경우) `parent`로 간다. */
export function useGoBack(parent: string): () => void {
  const navigate = useNavigate()
  return () => {
    if (hasPreviousScreen()) navigate(-1)
    else navigate(parent, { replace: true })
  }
}

/**
 * react-router는 앱 안에서 쌓은 방문 기록의 순번을 history.state.idx에 적는다. 앱을 연 첫 화면이 0이다.
 * location.key가 'default'인지로는 알 수 없다. 첫 화면에서 주소의 달만 바꿔도 key가 바뀐다.
 * idx는 공개 API가 아니므로 react-router를 올리는 PR에서는 SubScreen.test.tsx 결과를 PR 본문에 적는다.
 * react-router를 올리는 PR은 plugins/reactRouterTreeShake.ts가 고치는 모양(이름 목록)도 다시 맞춘다. 다르면 빌드가 멈춘다(#355).
 */
function hasPreviousScreen(): boolean {
  return window.history.state?.idx > 0
}
