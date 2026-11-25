import LoadFailure from '../components/LoadFailure'

/** 화면 코드가 예외를 던졌을 때 내용 자리에 보인다. 예외의 글자는 보이지 않는다. */
export default function ScreenError() {
  return <LoadFailure onRetry={() => window.location.reload()} />
}
