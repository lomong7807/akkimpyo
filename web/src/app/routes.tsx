import { Navigate, Outlet, ScrollRestoration, type RouteObject } from 'react-router'
import { MainScreen } from '../components/Screen'
import AccountsPage from '../features/accounts/AccountsPage'
import NotFoundPage from '../features/not-found/NotFoundPage'
import LedgerLayout from './LedgerLayout'
import LoginRoute from './LoginRoute'
import MoreRoute from './MoreRoute'
import { moreItem } from './navigation'
import PlainLayout from './PlainLayout'
import ScreenError from './ScreenError'
import SessionProvider from './SessionProvider'
import SignedInArea from './SignedInArea'
import SignedOutArea from './SignedOutArea'
import SignupRoute from './SignupRoute'

/** 주소는 화면설계서 00-common 12절을 따른다. 화면을 만드는 이슈가 자기 주소를 더한다. */
export const routes: RouteObject[] = [
  {
    element: (
      <SessionProvider>
        <ScrollRestoration />
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
          { path: '/signup', element: <SignupRoute /> },
        ],
      },
      {
        element: <SignedInArea />,
        children: [
          { path: '/', element: <Navigate to="/home" replace /> },
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
                  { path: '/more', element: <MoreRoute />, handle: { navigationItem: moreItem } },
                  { path: '/accounts', element: <AccountsPage /> },
                  { path: '*', element: <NotFoundPage /> },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
]
