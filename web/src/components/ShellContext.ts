import { createContext, type ReactNode } from 'react'

/**
 * 공통 틀이 화면의 상단 바·머리에 넣는 것(00-common 6.1, #235). 공통 틀(app)이 넘기고 화면의 틀(MainScreen, TitleBar,
 * FullScreenForm)이 제자리에 둔다. components는 연결과 기기 저장을 모르므로 그린 것을 받기만 한다. 공통 틀 밖(가입 등)에는 없다.
 */
export interface ShellParts {
  /** 연결 없음 띠(6.1 (6)). 상단 바·머리 바로 아래, 넓은 화면은 내용 영역 맨 위 */
  band?: ReactNode
  /** 동기화 상태 표시(B-04). 휴대폰 배치의 상단 바 오른쪽. 전체 화면 입력에는 없다 */
  syncStatus?: ReactNode
}

export const ShellContext = createContext<ShellParts>({})
