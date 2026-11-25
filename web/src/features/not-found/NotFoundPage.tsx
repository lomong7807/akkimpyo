import { MainScreen } from '../../components/Screen'
import NotFoundMessage from './NotFoundMessage'

/** N-01 찾을 수 없음 */
export default function NotFoundPage() {
  return (
    <MainScreen>
      <NotFoundMessage />
    </MainScreen>
  )
}
