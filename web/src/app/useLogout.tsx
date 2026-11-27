import { useState } from 'react'
import { logout, sessionUserId } from '../api/session'
import ConfirmDialog from '../components/ConfirmDialog'
import { countPending } from '../device/pendingQueue'

/**
 * 로그아웃(F-016, M-02 (5)). 이 기기에 보내지 않은 입력(대기와 보낼 수 없음)이 있으면 먼저 확인 창을 띄운다. 없으면 확인 없이
 * 로그아웃한다. 연결이 없어도 된다(작성자 판단 55). 로그아웃은 그 계정의 사본, 대기열, 쓰던 값을 지운다(api/session).
 * 건수를 읽지 못하면(저장소를 쓸 수 없음) 지울 것도 없으므로 확인 없이 로그아웃한다.
 * 자리는 1A와 같은 더보기 맨 아래 줄과 사이드바 맨 아래다(#81). 둘이 이 훅을 쓴다.
 */
export function useLogout() {
  const [asking, setAsking] = useState(false)
  // 닫히는 움직임 동안에도 같은 건수를 보이게 남긴다
  const [count, setCount] = useState(0)
  // 확인 창은 처음 물을 때 붙이고 그 뒤로는 닫히는 움직임을 위해 남긴다. 묻지 않는 동안 공통 틀에 창을 붙이지 않는다
  const [used, setUsed] = useState(false)

  async function onLogout() {
    const user = sessionUserId()
    const pending = user === undefined ? 0 : await countPending(user).then(
      ({ waiting, rejected }) => waiting + rejected,
      () => 0,
    )
    if (pending === 0) {
      logout()
      return
    }
    setCount(pending)
    setUsed(true)
    setAsking(true)
  }

  const dialog = used && (
    <ConfirmDialog
      open={asking}
      title="로그아웃할까요?"
      description={`보내지 않은 입력 ${count}건이 이 기기에서 사라져요`}
      closeLabel="닫기"
      actionLabel="로그아웃"
      onClose={() => setAsking(false)}
      onAction={() => {
        setAsking(false)
        logout()
      }}
    />
  )

  return { onLogout: () => void onLogout(), dialog }
}
