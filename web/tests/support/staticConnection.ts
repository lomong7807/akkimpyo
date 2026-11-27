import { watchConnection } from '../../src/api/connection'

/**
 * 앱 모듈을 정적으로 불러온 파일에서 연결 판단(api/connection)을 '있음'으로 되돌린다. 연결 오류를 일부러 낸 테스트가 끝에서
 * 부른다(그렇지 않으면 setup이 이름과 함께 실패시킨다, qa #289). 앱을 새로 여는 테스트(vi.resetModules)의 모듈에는 닿지 않는다.
 * DOM이 없는 파일에서도 불러올 수 있게 불러올 때 아무것도 하지 않는다.
 */
export function reconnectStaticApp(): void {
  const stop = watchConnection()
  window.dispatchEvent(new Event('online'))
  stop()
}
