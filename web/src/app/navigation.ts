import type { IconName } from '../components/Icon'

export interface NavigationItem {
  label: string
  /** 누르면 가는 첫 화면의 주소 */
  to: string
}

export interface MainNavigationItem extends NavigationItem {
  icon: IconName
}

/** 하단 탭에서 거래 입력 칸(빠른 입력 버튼, B-03)이 놓이는 자리 */
export const QUICK_ENTRY = 'quick-entry'

export interface Navigation {
  /** 하단 탭의 칸. 적은 순서대로 같은 폭으로 놓인다: 홈, 내역, 거래 입력(QUICK_ENTRY), 통계, 더보기 */
  tabs: (MainNavigationItem | typeof QUICK_ENTRY)[]
  /** 거래 입력을 여는 곳. 하단 탭의 거래 입력 칸과 사이드바의 "거래 입력" 버튼이 연다. */
  quickEntry?: NavigationItem
  /** tabs 가운데 하나. 어느 탭에도 속하지 않는 화면에서 강조한다(더보기). */
  fallbackTab?: MainNavigationItem
  sidebar: {
    /** 주 메뉴: 홈, 내역, 통계 */
    main: MainNavigationItem[]
    /** 구분선 아래 더보기 항목 */
    more: NavigationItem[]
  }
}

/** 라우트의 handle */
export interface ScreenHandle {
  /** 화면이 속한 항목. 하단 탭과 사이드바가 강조한다. */
  navigationItem?: NavigationItem
  /** 전체 화면 입력. 하단 탭이 없다. */
  fullScreen?: boolean
}

export const transactionsItem: MainNavigationItem = { label: '내역', to: '/transactions', icon: 'ListBullets' }
export const moreItem: MainNavigationItem = { label: '더보기', to: '/more', icon: 'DotsThree' }
export const accountsItem: NavigationItem = { label: '계좌', to: '/accounts' }
export const categoriesItem: NavigationItem = { label: '카테고리', to: '/categories' }
/** 거래 입력(D-04)을 지출 유형으로 연다. 화면이 아니라 여는 버튼이라 강조하지 않는다. */
export const quickEntryItem: NavigationItem = { label: '거래 입력', to: '/transactions/new' }

/**
 * 하단 탭과 사이드바의 항목. 화면을 만드는 이슈가 자기 항목을 더한다.
 * 1A에는 홈, 통계 탭이 아직 없어 하단 탭은 [내역, 거래 입력, 더보기] 세 칸이다(1A 임시).
 */
export const navigation: Navigation = {
  tabs: [transactionsItem, QUICK_ENTRY, moreItem],
  quickEntry: quickEntryItem,
  fallbackTab: moreItem,
  sidebar: { main: [transactionsItem], more: [accountsItem, categoriesItem] },
}
