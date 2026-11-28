import { Navigate, Outlet, type RouteObject } from 'react-router'
import { MainScreen } from '../components/Screen'
import HomePage from '../features/home/HomePage'
import ClearStaleCaret from './ClearStaleCaret'
import LedgerLayout from './LedgerLayout'
import ListDetailLayout from './ListDetailLayout'
import { accountsItem, categoriesItem, exportItem, homeItem, moreItem, statsItem, transactionsItem } from './navigation'
import PlainLayout from './PlainLayout'
import ScreenError from './ScreenError'
import {
  accountAddScreen,
  accountEditScreen,
  accountsScreen,
  categoriesScreen,
  exportScreen,
  loginScreen,
  monthlyStatsScreen,
  moreScreen,
  notFoundScreen,
  pendingFixScreen,
  pendingScreen,
  signupScreen,
  transactionCalendarScreen,
  transactionDetailScreen,
  transactionEditScreen,
  transactionListScreen,
  transactionNewScreen,
  welcomeScreen,
} from './screens'
import ScrollPosition from './ScrollPosition'
import SessionProvider from './SessionProvider'
import SignedInArea from './SignedInArea'
import SignedOutArea from './SignedOutArea'

/**
 * 주소는 화면설계서 00-common 12절을 따른다. 화면을 만드는 이슈가 자기 주소를 더한다.
 * 홈 말고는 화면 코드를 따로 싣는다(screens.tsx, #251, 로그인은 #355). 라우트와 handle은 묶음을 받기 전에도 공통 틀이 맞게 그려지도록 여기 둔다.
 */
export const routes: RouteObject[] = [
  {
    element: (
      <SessionProvider>
        {/* 위치를 되살리기 전에 앞 화면의 커서를 지운다. 순서를 바꾸지 않는다 */}
        <ClearStaleCaret />
        <ScrollPosition />
        <Outlet />
      </SessionProvider>
    ),
    errorElement: (
      <PlainLayout>
        <ScreenError />
      </PlainLayout>
    ),
    children: [
      {
        element: <SignedOutArea />,
        children: [
          { element: <PlainLayout />, children: [{ path: '/login', element: <loginScreen.Screen /> }] },
          { path: '/signup', element: <signupScreen.Screen /> },
        ],
      },
      {
        element: <SignedInArea />,
        children: [
          { path: '/', element: <Navigate to="/home" replace /> },
          // 공통 틀이 없다(가입 A-03과 같은 틀)
          { path: '/welcome', element: <welcomeScreen.Screen /> },
          {
            element: <LedgerLayout />,
            children: [
              {
                // 예외가 나도 공통 틀은 남겨 다른 화면으로 갈 수 있게 한다
                errorElement: (
                  <MainScreen>
                    <ScreenError />
                  </MainScreen>
                ),
                children: [
                  { path: '/home', element: <HomePage />, handle: { navigationItem: homeItem } },
                  { path: '/more', element: <moreScreen.Screen />, handle: { navigationItem: moreItem } },
                  // 넓은 화면은 오른쪽 칸이 있는 두 칸이다(G-01 넓은 화면, #244). 1B 동안 계좌 줄은 누를 수 없어 안내만 보인다(#82)
                  // 목록에서 연 계좌 추가(G-02)는 넓은 화면에서 오른쪽 칸이다(G-02 넓은 화면, #244)
                  {
                    path: '/accounts',
                    element: <ListDetailLayout list={<accountsScreen.Screen />} empty="계좌를 고르면 여기에 자세히 보여요" />,
                    handle: { navigationItem: accountsItem },
                    children: [{ path: 'new', element: <accountAddScreen.Screen />, handle: { fullScreen: true } }],
                  },
                  // 1B 임시: 넓은 화면에서도 G-01 오른쪽 칸이 아닌 한 칸이다(#244)
                  {
                    path: '/accounts/:id/edit',
                    element: <accountEditScreen.Screen />,
                    handle: { navigationItem: accountsItem, fullScreen: true },
                  },
                  { path: '/categories', element: <categoriesScreen.Screen />, handle: { navigationItem: categoriesItem } },
                  // K-01(#240). 하단 탭은 더보기, 넓은 화면은 사이드바의 "내보내기"를 강조한다
                  { path: '/export', element: <exportScreen.Screen />, handle: { navigationItem: exportItem } },
                  // 사이드바 항목이 없다. 주소로 열면 하단 탭은 더보기를 강조한다(00-common 6.2)
                  { path: '/pending', element: <pendingScreen.Screen /> },
                  // 고쳐서 보내기(planner #237 P1). 1B 임시: 넓은 화면에서도 B-05 오른쪽 칸이 아닌 한 칸이다(#244)
                  { path: '/pending/:id/edit', element: <pendingFixScreen.Screen />, handle: { fullScreen: true } },
                  // 넓은 화면은 목록 옆 오른쪽 칸에 거래 상세(D-01 (13), D-06 넓은 화면)를 두는 두 칸이다. 상세는 자식 라우트다(#244)
                  {
                    path: '/transactions',
                    element: (
                      <ListDetailLayout list={<transactionListScreen.Screen />} empty="거래를 고르면 여기에 자세히 보여요" />
                    ),
                    // 내역에서 누른 사이드바의 "거래 입력"은 오른쪽 칸에 연다(entryInPane)
                    handle: { navigationItem: transactionsItem, entryInPane: true },
                    // 목록에서 연 입력·수정(D-04)은 넓은 화면에서 오른쪽 칸이고, 아니면 전체 화면이다(00-common 5.5)
                    children: [
                      { path: ':id', element: <transactionDetailScreen.Screen /> },
                      { path: 'new', element: <transactionNewScreen.Screen />, handle: { fullScreen: true } },
                      { path: ':id/edit', element: <transactionEditScreen.Screen />, handle: { fullScreen: true } },
                    ],
                  },
                  // 거래 상세(/transactions/:id)보다 앞에 둔다(정적 경로가 이기지만 순서로도 분명히 한다, architect #300 C)
                  {
                    path: '/transactions/calendar',
                    element: <transactionCalendarScreen.Screen />,
                    handle: { navigationItem: transactionsItem },
                  },
                  // E-01(#242). 1C의 카테고리별(E-02)·연 단위(E-05) 통계도 이 아래 주소에 같은 항목으로 둔다
                  {
                    path: '/stats/monthly',
                    element: <monthlyStatsScreen.Screen />,
                    handle: { navigationItem: statsItem },
                  },
                  { path: '*', element: <notFoundScreen.Screen /> },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
]
