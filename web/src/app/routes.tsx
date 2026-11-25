import { Outlet, ScrollRestoration, type RouteObject } from 'react-router'
import LoginPage from '../features/auth/LoginPage'
import NotFoundPage from '../features/not-found/NotFoundPage'
import AppLayout from './AppLayout'
import { navigation } from './navigation'
import PlainLayout from './PlainLayout'

/** 주소는 화면설계서 00-common 12절을 따른다. 화면을 만드는 이슈가 자기 주소를 더한다. */
export const routes: RouteObject[] = [
  {
    element: (
      <>
        <ScrollRestoration />
        <Outlet />
      </>
    ),
    children: [
      { element: <PlainLayout />, children: [{ path: '/login', element: <LoginPage /> }] },
      {
        element: <AppLayout navigation={navigation} />,
        children: [{ path: '*', element: <NotFoundPage /> }],
      },
    ],
  },
]
