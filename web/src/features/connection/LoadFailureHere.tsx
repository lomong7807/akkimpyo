import type { ComponentProps } from 'react'
import LoadFailure from '../../components/LoadFailure'
import { useConnection } from './useConnection'

/**
 * 지금 연결에 맞춘 불러오기 실패(F-907, F-908). 연결이 없으면 "연결되면 자동으로 불러올게요."만 보이고 버튼을 두지 않는다
 * (00-common 4.1, 4.3, N-03). 연결이 돌아오면 보이는 조회를 다시 받는다(app/queryClient의 refetchOnReconnect).
 * 화면과 app은 이것을 쓴다(architect #238).
 */
export default function LoadFailureHere(props: Omit<ComponentProps<typeof LoadFailure>, 'offline'>) {
  return <LoadFailure {...props} offline={useConnection() === 'offline'} />
}
