import { ButtonLink } from '../../components/Button'
import ScreenMessage from '../../components/ScreenMessage'

/** 찾을 수 없음의 안내. 공통 틀이 없는 화면에서는 이것만 쓴다. */
export default function NotFoundMessage() {
  return (
    <ScreenMessage title="찾을 수 없어요." description="주소가 바뀌었거나 지워진 항목일 수 있어요.">
      <ButtonLink kind="primary" to="/home">
        홈으로
      </ButtonLink>
    </ScreenMessage>
  )
}
