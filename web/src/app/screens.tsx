import type { ReactNode } from 'react'
import FullScreenFormShell from '../components/FullScreenFormShell'
import { MainScreen, SubScreen } from '../components/Screen'
import AccountsSkeleton from '../features/accounts/AccountsSkeleton'
import AddAccountLink from '../features/accounts/AddAccountLink'
import { CategoriesScreenSkeleton } from '../features/categories/CategoriesSkeleton'
import { MonthlyStatsShell } from '../features/stats/MonthlyStatsSkeleton'
import CalendarSkeleton from '../features/transactions/CalendarSkeleton'
import { DetailSkeleton } from '../features/transactions/TransactionDetailSkeleton'
import TransactionFieldsSkeleton from '../features/transactions/TransactionFieldsSkeleton'
import { HistorySkeleton } from '../features/transactions/TransactionListSkeleton'
import { lazyScreen, type ScreenShell } from './lazyScreen'
import Loading from './Loading'
import PlainLayout from './PlainLayout'
import { NoFrame, SignupFrame, TransactionEditFrame } from './screenFrames'

/*
 * 따로 싣는 화면(#251). 첫 묶음에는 세션과 로그인 가드, 공통 틀(사이드바, 하단 탭), 홈만 둔다. 로그인 화면도 따로 싣는다(#355).
 * 틀(shell)은 그 화면과 같은 상단 바와 그 화면이 받는 동안 보이는 뼈대다. 뼈대가 없는 화면(받을 데이터가 없는 화면)은
 * 보일 것이 아직 없는 동안의 글(Loading)을 둔다. 화면의 제목과 "뒤로"가 가는 곳을 바꾸면 여기도 바꾼다.
 */

type Frame = ScreenShell['Frame']

function subScreen(title: string, parent: string, action?: ReactNode, fullWidth = false): Frame {
  return function SubScreenFrame({ children }) {
    return (
      <SubScreen title={title} parent={parent} action={action} fullWidth={fullWidth}>
        {children}
      </SubScreen>
    )
  }
}

function fullScreenForm(title: string, parent: string): Frame {
  return function FullScreenFormFrame({ children }) {
    return (
      <FullScreenFormShell title={title} parent={parent}>
        {children}
      </FullScreenFormShell>
    )
  }
}

export const transactionListScreen = lazyScreen(() => import('../features/transactions/TransactionListPage'), {
  Frame: MainScreen,
  Placeholder: HistorySkeleton,
})

/** D-02. 넓은 화면은 두 칸이라 내용 영역 전체 폭이다. 화면은 앞 화면이 없을 때 "뒤로"가 그 달의 내역으로 간다 */
export const transactionCalendarScreen = lazyScreen(() => import('../features/transactions/CalendarPage'), {
  Frame: subScreen('달력', '/transactions', undefined, true),
  Placeholder: CalendarSkeleton,
  headingLevel: 2,
})

export const transactionNewScreen = lazyScreen(() => import('../features/transactions/TransactionNewPage'), {
  Frame: fullScreenForm('거래 입력', '/home'),
  // 칸은 거래 수정과 같다
  Placeholder: TransactionFieldsSkeleton,
  headingLevel: 2,
})

export const transactionDetailScreen = lazyScreen(() => import('../features/transactions/TransactionDetailPage'), {
  // 수정 버튼은 거래를 받은 뒤에 보이므로 틀에는 없다
  Frame: subScreen('거래 상세', '/transactions'),
  Placeholder: DetailSkeleton,
  headingLevel: 2,
})

export const transactionEditScreen = lazyScreen(() => import('../features/transactions/TransactionEditPage'), {
  Frame: TransactionEditFrame,
  Placeholder: TransactionFieldsSkeleton,
  headingLevel: 2,
})

export const accountsScreen = lazyScreen(() => import('../features/accounts/AccountsPage'), {
  Frame: subScreen('계좌', '/more', <AddAccountLink kind="text">추가</AddAccountLink>),
  Placeholder: AccountsSkeleton,
  headingLevel: 2,
})

export const accountAddScreen = lazyScreen(() => import('../features/accounts/AccountAddPage'), {
  Frame: fullScreenForm('계좌 추가', '/accounts'),
  Placeholder: Loading,
  headingLevel: 2,
})

export const categoriesScreen = lazyScreen(() => import('../features/categories/CategoriesPage'), {
  Frame: subScreen('카테고리', '/more'),
  Placeholder: CategoriesScreenSkeleton,
  headingLevel: 2,
})

/** K-01 내보내기(#240). 받아 오는 데이터가 없어(장부 이름은 기기에 있다) 뼈대가 없다 */
export const exportScreen = lazyScreen(() => import('../features/export/ExportPage'), {
  Frame: subScreen('내보내기', '/more'),
  Placeholder: Loading,
  headingLevel: 2,
})

/** B-05. 기기 데이터라 뼈대가 없다(#236) */
export const pendingScreen = lazyScreen(() => import('../features/pending/PendingPage'), {
  Frame: subScreen('보내지 않은 입력', '/more'),
  Placeholder: Loading,
  headingLevel: 2,
})

/** B-05의 "고쳐서 보내기"가 연 거래 입력(#237). 칸은 거래 입력과 같고 닫으면 B-05로 간다 */
export const pendingFixScreen = lazyScreen(() => import('../features/pending/PendingFixPage'), {
  Frame: fullScreenForm('거래 입력', '/pending'),
  Placeholder: TransactionFieldsSkeleton,
  headingLevel: 2,
})

/** E-01 월별 통계(#242). 탭의 첫 화면이라 상단 바는 장부 이름이다. 화면 제목(h1)은 화면이 그린다 */
export const monthlyStatsScreen = lazyScreen(() => import('../features/stats/MonthlyStatsPage'), {
  Frame: MainScreen,
  Placeholder: MonthlyStatsShell,
})

export const moreScreen = lazyScreen(() => import('./MoreRoute'), { Frame: MainScreen, Placeholder: Loading })

export const notFoundScreen = lazyScreen(() => import('../features/not-found/NotFoundPage'), {
  Frame: MainScreen,
  Placeholder: Loading,
})

export const signupScreen = lazyScreen(() => import('./SignupRoute'), {
  Frame: SignupFrame,
  Placeholder: Loading,
  headingLevel: 2,
})

export const welcomeScreen = lazyScreen(() => import('./WelcomeRoute'), { Frame: PlainLayout, Placeholder: Loading })

/**
 * A-02 로그인(#355). 화면과 폼만 따로 싣는다. 로그인이 끝날 때의 처리(쓰던 값 남기기, 기기 데이터 지우기, 탭 사이 알림)는
 * SessionProvider와 api/session에 있어 첫 묶음에 남는다(architect 기준 나). 기기에 로그인 기록이 없으면 SessionProvider가
 * 갱신의 답을 기다리지 않고 미리 받는다.
 */
export const loginScreen = lazyScreen(() => import('./LoginRoute'), { Frame: NoFrame, Placeholder: Loading })
