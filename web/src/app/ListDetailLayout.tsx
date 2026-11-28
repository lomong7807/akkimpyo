import { Fragment, type ReactNode } from 'react'
import { useLocation, useOutlet } from 'react-router'
import EmptyState from '../components/EmptyState'
import { isOpenedFromList } from '../components/openedFromList'
import { InPaneContext, SidePaneContext } from '../components/sidePane'
import { useWideScreen } from '../components/wideScreen'
import { useScreenHandle } from './useScreenHandle'

interface ListDetailLayoutProps {
  /** 목록 화면 */
  list: ReactNode
  /** 아무것도 고르지 않았을 때 오른쪽 칸의 안내 */
  empty: string
}

/**
 * 목록·상세 두 칸 화면(00-common 2.5, D-01 (13), G-01 넓은 화면, #244). 상세는 이 라우트의 자식 라우트다.
 * - 넓은 화면(1024px 이상): 목록을 그리고, 목록 화면의 틀이 그 옆 오른쪽 칸에 자식 라우트의 화면을 둔다. 자식이 없으면 안내 문구다.
 *   오른쪽 칸 화면은 대화상자가 아닌 라우트 화면이라 주소가 바뀌고 새로고침과 뒤로가 그대로 된다(12.1).
 *   입력·수정(handle에 fullScreen)은 목록에서 열었을 때(openedFromList)만 오른쪽 칸이다. 다른 화면에서 열었거나 주소를 바로 열면
 *   전체 화면이다(00-common 5.5).
 * - 그 아래: 지금처럼 한 칸이다. 자식 라우트가 있으면 그 화면만, 없으면 목록만 그린다.
 * 창 폭이 1024px을 넘나들면 같은 주소를 그 폭의 배치로 다시 그린다(designer #102).
 */
export default function ListDetailLayout({ list, empty }: ListDetailLayoutProps) {
  const wide = useWideScreen()
  const outlet = useOutlet()
  const { pathname, state } = useLocation()
  const { fullScreen } = useScreenHandle()
  if (!wide || (fullScreen && !isOpenedFromList(state))) return outlet ?? list
  // 칸 안의 화면은 두 칸이 아니다. 다른 거래를 고르면 그 화면을 새로 그린다(앞 거래의 확인 창, 보내는 중 같은 상태를 넘기지 않는다)
  const pane = (
    <SidePaneContext value={undefined}>
      <InPaneContext value>{outlet ? <Fragment key={pathname}>{outlet}</Fragment> : <EmptyState description={empty} />}</InPaneContext>
    </SidePaneContext>
  )
  return <SidePaneContext value={pane}>{list}</SidePaneContext>
}
