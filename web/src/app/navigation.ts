import type { IconName } from '../components/Icon'

export interface NavigationItem {
  label: string
  /** 누르면 가는 첫 화면의 주소 */
  to: string
}

export interface MainNavigationItem extends NavigationItem {
  icon: IconName
}

export interface Navigation {
  /** 하단 탭의 칸. 적은 순서대로 같은 폭으로 놓인다: 홈, 내역, 거래 입력, 통계, 더보기 */
  tabs: MainNavigationItem[]
  /** tabs 가운데 하나. 어느 탭에도 속하지 않는 화면에서 강조한다(더보기). */
  fallbackTab?: MainNavigationItem
  sidebar: {
    /** 주 메뉴: 홈, 내역, 통계 */
    main: MainNavigationItem[]
    /** 구분선 아래 더보기 항목 */
    more: NavigationItem[]
  }
}

/** 라우트의 handle. 화면이 속한 항목을 적으면 하단 탭과 사이드바가 그 항목을 강조한다. */
export interface ScreenHandle {
  navigationItem?: NavigationItem
}

/** 하단 탭과 사이드바의 항목. 화면을 만드는 이슈가 자기 항목을 더한다. */
export const navigation: Navigation = {
  tabs: [],
  sidebar: { main: [], more: [] },
}
