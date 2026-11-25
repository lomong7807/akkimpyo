import { ButtonLink } from '../../components/Button'
import { MainScreen } from '../../components/Screen'
import ScreenMessage from '../../components/ScreenMessage'

/** N-01 찾을 수 없음 */
export default function NotFoundPage() {
  return (
    <MainScreen>
      <ScreenMessage title="찾을 수 없어요." description="주소가 바뀌었거나 지워진 항목일 수 있어요.">
        <ButtonLink kind="primary" to="/home">
          홈으로
        </ButtonLink>
      </ScreenMessage>
    </MainScreen>
  )
}
