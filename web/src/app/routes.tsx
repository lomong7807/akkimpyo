import { Outlet, ScrollRestoration, type RouteObject } from 'react-router'
import { MainScreen } from '../components/Screen'
import LoginPage from '../features/auth/LoginPage'
import NotFoundPage from '../features/not-found/NotFoundPage'
import AppLayout from './AppLayout'
import { navigation } from './navigation'
import PlainLayout from './PlainLayout'
import ScreenError from './ScreenError'

/** 주소는 화면설계서 00-common 12절을 따른다. 화면을 만드는 이슈가 자기 주소를 더한다. */
export const routes: RouteObject[] = [
  {
    element: (
      <>
        <ScrollRestoration />
        <Outlet />
      </>
    ),
    errorElement: (
      <PlainLayout>
        <ScreenError />
      </PlainLayout>
    ),
    children: [
      { element: <PlainLayout />, children: [{ path: '/login', element: <LoginPage /> }] },
      {
        element: <AppLayout navigation={navigation} />,
        children: [
          {
            // 예외가 나도 공통 틀은 남겨 다른 화면으로 갈 수 있게 한다
            errorElement: (
              <MainScreen>
                <ScreenError />
              </MainScreen>
            ),
            children: [{ path: '*', element: <NotFoundPage /> }],
          },
        ],
      },
    ],
  },
]
