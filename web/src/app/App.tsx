import { QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { createQueryClient } from './queryClient'
import { routes } from './routes'

/** 로그인 앞의 화면이 쓴다. 로그인한 사람의 데이터는 SignedInArea가 로그인마다 새로 만드는 캐시에 둔다. */
const queryClient = createQueryClient()
const router = createBrowserRouter(routes)

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
