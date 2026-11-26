import { useId, type Ref } from 'react'
import { Button } from '../../components/Button'
import RetryMessage from '../../components/RetryMessage'
import { accountValuesOf } from '../accounts/accountDraft'
import AccountFields, { type AccountFieldTexts } from '../accounts/AccountFields'
import { useKeepDraft } from '../drafts/keepDraft'
import { useRestoredDraft } from '../drafts/restoreDraft'
import type { FirstAccount } from './useFirstAccount'
import WelcomeStep from './WelcomeStep'
import styles from './Welcome.module.css'

/** C-02 (8)의 문구. 종류, 시작 잔액, 기준일은 계좌 추가(G-02)와 같다(planner 결정 #102). */
const firstAccountTexts: AccountFieldTexts = {
  nameLabel: '계좌 이름',
  namePlaceholder: '예: 국민은행 통장',
}

interface FirstAccountStepProps {
  heading: Ref<HTMLHeadingElement>
  account: FirstAccount
}

/** 둘째 장: 첫 계좌 만들기(C-02 (7)~(13)) */
export default function FirstAccountStep({ heading, account }: FirstAccountStepProps) {
  const { form, busy, sender, failures, create, skip, retry } = account
  const skipNoteId = useId()
  // 로그인이 풀리면 쓰던 값을 이 기기에 남기고, 같은 계정으로 이 장에 돌아오면 채운다(00-common 4.1, #234 C2)
  useKeepDraft('first-account', () => (form.changed ? form.values : undefined))
  useRestoredDraft('first-account', (saved) => {
    const values = accountValuesOf(saved)
    if (values) form.change(values)
  })
  return (
    <WelcomeStep
      step={2}
      title="첫 계좌를 만들어 주세요"
      heading={heading}
      onSubmit={create}
      bottom={
        <>
          {/* 이 영역은 화면 키보드 위로 올라가지 않으므로 실패할 때마다 초점을 "다시 시도"로 옮겨 키보드를 내린다(가입 A-03과 같다, designer 결정 #102) */}
          {failures !== undefined && (
            <RetryMessage
              failures={failures}
              onRetry={retry}
              busy={busy && sender === 'retry'}
              disabled={busy && sender !== 'retry'}
              autoFocus
            >
              문제가 생겨 계좌를 만들지 못했어요. 잠시 후 다시 시도해 주세요.
            </RetryMessage>
          )}
          <Button kind="primary" type="submit" busy={busy && sender === 'create'} disabled={busy}>
            계좌 만들기
          </Button>
          <div className={styles.skip}>
            <Button
              kind="text"
              busy={busy && sender === 'skip'}
              disabled={busy}
              aria-describedby={skipNoteId}
              onClick={skip}
            >
              건너뛰기
            </Button>
            <p id={skipNoteId} className={styles.skipNote}>
              &quot;현금&quot; 계좌를 만들고 시작해요
            </p>
          </div>
        </>
      }
    >
      <p className={styles.description}>자주 쓰는 통장이나 카드 하나면 돼요. 나머지는 나중에 더할 수 있어요.</p>
      <div className={styles.fields}>
        <AccountFields form={form} readOnly={busy} texts={firstAccountTexts} />
      </div>
    </WelcomeStep>
  )
}
