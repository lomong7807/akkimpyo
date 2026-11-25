import { Button } from '../components/Button'
import ScreenMessage from '../components/ScreenMessage'

/** 화면 코드가 예외를 던졌을 때 내용 자리에 보인다. 문구는 F-907을 따르고 예외의 글자는 보이지 않는다. */
export default function ScreenError() {
  return (
    <ScreenMessage title="불러오지 못했어요." description="잠시 후 다시 시도해 주세요.">
      <Button kind="text" onClick={() => window.location.reload()}>
        다시 시도
      </Button>
    </ScreenMessage>
  )
}
