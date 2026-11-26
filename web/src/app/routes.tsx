import { Navigate, Outlet, type RouteObject } from 'react-router'
import { MainScreen } from '../components/Screen'
import HomePage from '../features/home/HomePage'
import ClearStaleCaret from './ClearStaleCaret'
import LedgerLayout from './LedgerLayout'
import LoginRoute from './LoginRoute'
import { accountsItem, categoriesItem, homeItem, moreItem, transactionsItem } from './navigation'
import PlainLayout from './PlainLayout'
import ScreenError from './ScreenError'
import {
  accountAddScreen,
  accountsScreen,
  categoriesScreen,
  moreScreen,
  notFoundScreen,
  signupScreen,
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
 * 로그인과 홈 말고는 화면 코드를 따로 싣는다(screens.tsx, #251). 라우트와 handle은 묶음을 받기 전에도 공통 틀이 맞게 그려지도록 여기 둔다.
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
          { element: <PlainLayout />, children: [{ path: '/login', element: <LoginRoute /> }] },
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
                  { path: '/accounts', element: <accountsScreen.Screen />, handle: { navigationItem: accountsItem } },
                  {
                    path: '/accounts/new',
                    element: <accountAddScreen.Screen />,
                    handle: { navigationItem: accountsItem, fullScreen: true },
                  },
                  { path: '/categories', element: <categoriesScreen.Screen />, handle: { navigationItem: categoriesItem } },
                  {
                    path: '/transactions',
                    element: <transactionListScreen.Screen />,
                    handle: { navigationItem: transactionsItem },
                  },
                  { path: '/transactions/new', element: <transactionNewScreen.Screen />, handle: { fullScreen: true } },
                  {
                    path: '/transactions/:id',
                    element: <transactionDetailScreen.Screen />,
                    handle: { navigationItem: transactionsItem },
                  },
                  {
                    path: '/transactions/:id/edit',
                    element: <transactionEditScreen.Screen />,
                    handle: { navigationItem: transactionsItem, fullScreen: true },
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
