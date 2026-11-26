import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useEffectEvent } from 'react'
import { connection, onConnectionChange } from '../../api/connection'
import { ledgerScope } from '../me/ledgerKey'

/*
 * 쌓인 입력을 저절로 보내는 계기(F-105, ADR 006 결정 6, #235). 앱이 열려 있을 때만 보낸다. 백그라운드 전송과 service worker의
 * 전송은 만들지 않는다(planner 2026-11-27, P-225).
 * - 앱을 열 때(로그인을 확인한 때), 연결이 돌아왔을 때, 화면이 다시 보일 때
 * - 열려 있는 동안 1분마다. 화면이 보이고 연결이 있을 때만 보낸다(숨은 탭이 요청을 보내지 않게, architect #235)
 * 보내는 코드(sendQueue)는 첫 계기에 따로 받는다(architect #235 A).
 */

/** 열려 있는 동안 보내는 간격 */
export const SEND_EVERY_MS = 60_000

/**
 * `enabled`(토큰이 있는 로그인)인 동안 계기마다 보낸다. 보낸 장부의 서버 데이터는 무효로 만든다. 한 번의 보내기에서 200이고
 * 알릴 것이 있으면 `onNoticed`에 그 건수를 준다.
 */
export function useAutoSend(enabled: boolean, onNoticed?: (count: number) => void): void {
  const queryClient = useQueryClient()
  const notice = useEffectEvent((count: number) => onNoticed?.(count))

  useEffect(() => {
    if (!enabled) return
    let stopped = false
    let running = false
    let again = false
    let timer: ReturnType<typeof setTimeout> | undefined

    // 보내는 중에 계기가 오면 끝난 뒤 한 번 더 보낸다(보내던 중 연결이 끊겼다 돌아온 경우 등)
    async function send() {
      if (!canSend()) return
      if (running) {
        again = true
        return
      }
      running = true
      try {
        do {
          again = false
          const noticed = await sendOnce()
          if (!stopped && noticed > 0) notice(noticed)
        } while (again && !stopped && canSend())
      } finally {
        running = false
      }
    }

    async function sendOnce(): Promise<number> {
      try {
        const { sendQueue } = await import('./sendQueue')
        if (stopped) return 0
        const onSent = (ledgerId: string) => void queryClient.invalidateQueries({ queryKey: ledgerScope(ledgerId) })
        return (await sendQueue({ onSent })).noticed
      } catch {
        // 조각을 받지 못했다. 입력은 대기열에 그대로이고 다음 계기에 다시 부른다
        return 0
      }
    }

    function canSend() {
      return !stopped && document.visibilityState === 'visible' && connection() === 'online'
    }

    function tick() {
      timer = setTimeout(() => {
        void send()
        tick()
      }, SEND_EVERY_MS)
    }

    function onVisibility() {
      if (document.visibilityState === 'visible') void send()
    }

    const stopConnection = onConnectionChange((next) => {
      if (next === 'online') void send()
    })
    document.addEventListener('visibilitychange', onVisibility)
    void send()
    tick()
    return () => {
      stopped = true
      clearTimeout(timer)
      stopConnection()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled, queryClient])
}
