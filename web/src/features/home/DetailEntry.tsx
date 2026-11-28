import type { MouseEvent } from 'react'
import { useNavigate } from 'react-router'
import { sessionUserId } from '../../api/session'
import { ButtonLink } from '../../components/Button'
import { holdKeyboard } from '../../components/keyboardBridge'
import { detailPayeeOf } from '../../lib/oneLine'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { handOffToEntry } from '../transactions/oneLineHandoff'
import styles from './Home.module.css'

/**
 * 해석에 실패한 한 줄 아래의 글자 링크 "자세히 입력"(F-210 해석 규칙 8). 글 전체(100자까지)를 가맹점/내용에 채운 거래 입력(D-04)을
 * 연다. 새 탭이나 창으로 여는 누름은 브라우저에 맡긴다(빈 새 입력).
 */
export default function DetailEntry({ text }: { text: string }) {
  const navigate = useNavigate()
  const ledger = useCurrentLedger()

  function openDetail(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    holdKeyboard(event)
    const owner = { userId: sessionUserId(), ledgerId: ledger.id }
    const state = handOffToEntry(owner, { text, values: { payee: detailPayeeOf(text) } })
    void navigate('/transactions/new', { state })
  }

  return (
    <div className={styles.detailEntry}>
      <ButtonLink kind="text" to="/transactions/new" onClick={openDetail}>
        자세히 입력
      </ButtonLink>
    </div>
  )
}
