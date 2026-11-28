import { createContext, type ReactNode } from 'react'

/**
 * 넓은 화면의 두 칸 화면(D-01 내역, G-01 계좌, 00-common 2.5)이 목록 칸 옆에 둘 오른쪽 칸의 내용. 목록 화면의 틀
 * (MainScreen, SubScreen)이 내용 자리를 두 칸으로 나눠 그린다. 두 칸이 아니면(휴대폰 배치, 다른 화면) undefined다.
 */
export const SidePaneContext = createContext<ReactNode>(undefined)

/** 오른쪽 칸 안의 화면인지. 하위 화면의 틀은 상단 바 대신 칸의 머리(화면 이름과 화면별 버튼)를 그린다(D-06 넓은 화면). */
export const InPaneContext = createContext(false)
