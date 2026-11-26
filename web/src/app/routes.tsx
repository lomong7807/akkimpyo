import { Navigate, Outlet, ScrollRestoration, type RouteObject } from 'react-router'
import { MainScreen } from '../components/Screen'
import AccountAddPage from '../features/accounts/AccountAddPage'
import AccountsPage from '../features/accounts/AccountsPage'
import CategoriesPage from '../features/categories/CategoriesPage'
import HomePage from '../features/home/HomePage'
import NotFoundPage from '../features/not-found/NotFoundPage'
import TransactionDetailPage from '../features/transactions/TransactionDetailPage'
import TransactionEditPage from '../features/transactions/TransactionEditPage'
import TransactionListPage from '../features/transactions/TransactionListPage'
import TransactionNewPage from '../features/transactions/TransactionNewPage'
import LedgerLayout from './LedgerLayout'
import LoginRoute from './LoginRoute'
import MoreRoute from './MoreRoute'
import { accountsItem, categoriesItem, homeItem, moreItem, transactionsItem } from './navigation'
import PlainLayout from './PlainLayout'
import ScreenError from './ScreenError'
import SessionProvider from './SessionProvider'
import SignedInArea from './SignedInArea'
import SignedOutArea from './SignedOutArea'
import SignupRoute from './SignupRoute'
import WelcomeRoute from './WelcomeRoute'

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
          // 공통 틀이 없다(가입 A-03과 같은 틀)
          { path: '/welcome', element: <WelcomeRoute /> },
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
                  { path: '/more', element: <MoreRoute />, handle: { navigationItem: moreItem } },
                  { path: '/accounts', element: <AccountsPage />, handle: { navigationItem: accountsItem } },
                  {
                    path: '/accounts/new',
                    element: <AccountAddPage />,
                    handle: { navigationItem: accountsItem, fullScreen: true },
                  },
                  { path: '/categories', element: <CategoriesPage />, handle: { navigationItem: categoriesItem } },
                  {
                    path: '/transactions',
                    element: <TransactionListPage />,
                    handle: { navigationItem: transactionsItem },
                  },
                  { path: '/transactions/new', element: <TransactionNewPage />, handle: { fullScreen: true } },
                  {
                    path: '/transactions/:id',
                    element: <TransactionDetailPage />,
                    handle: { navigationItem: transactionsItem },
                  },
                  {
                    path: '/transactions/:id/edit',
                    element: <TransactionEditPage />,
                    handle: { navigationItem: transactionsItem, fullScreen: true },
                  },
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
