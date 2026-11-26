import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useToast } from '../../components/ToastContext'
import { today } from '../../lib/calendarDate'
import { accountAddMessages, toNewAccount, type AccountMessages } from '../accounts/accountForm'
import { isDuplicateName, rejectedFields } from '../accounts/accountRejection'
import type { NewAccount } from '../accounts/accounts'
import { accountsKey } from '../accounts/useAccounts'
import { useAccountForm } from '../accounts/useAccountForm'
import { useCreateAccount } from '../accounts/useCreateAccount'
import { useCurrentLedger } from '../me/CurrentLedgerContext'

/** 안내를 마치고 가는 곳. 로그인하기 전에 가려던 주소(복귀 주소)는 쓰지 않는다. */
const HOME = '/home'

/** C-02 입력값 오류(#84). 계좌 추가(G-02)와 다른 것만 바꾼다. */
const firstAccountMessages: AccountMessages = {
  ...accountAddMessages,
  nameRequired: '계좌 이름을 입력해 주세요',
  nameDuplicate: '같은 이름의 계좌가 있어요',
}

/** "건너뛰기"가 만드는 계좌. 이 장에 쓰던 값은 쓰지 않는다. 기준일은 누른 때의 기기의 오늘이다. */
function cashAccount(): NewAccount {
  return { name: '현금', type: 'CASH', openingBalance: 0, openingDate: today() }
}

type Action = 'create' | 'skip'

export type FirstAccount = ReturnType<typeof useFirstAccount>

/**
 * 둘째 장의 칸과 두 동작(C-02 (8)~(13)). 만들면 /home으로 가고 토스트를 보인다.
 * 장을 오가도 쓰던 값이 남도록 안내 화면이 쥔다.
 */
export function useFirstAccount() {
  const ledger = useCurrentLedger()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const showToast = useToast()
  const form = useAccountForm(firstAccountMessages)
  const creation = useCreateAccount()
  const [pressed, setPressed] = useState<Action>('create')
  const createButton = useRef<HTMLButtonElement>(null)
  const skipButton = useRef<HTMLButtonElement>(null)

  const busy = creation.isPending || creation.isSuccess
  // 칸에 보인 거부와, 계좌가 생긴 것으로 보는 거부는 실패가 아니다
  const failed =
    creation.isError && !(pressed === 'create' ? rejectedOnFields(creation.error) : isDuplicateName(creation.error))

  // 안내를 떠난 뒤에 온 응답으로는 불리지 않는다
  function finish(message?: string) {
    if (message) showToast(message)
    navigate(HOME, { replace: true })
  }

  function create() {
    setPressed('create')
    if (!form.checkAll()) {
      creation.reset()
      return
    }
    creation.mutate(toNewAccount(form.values), {
      onSuccess: () => finish('계좌를 만들었어요'),
      onError: (error) => {
        const rejected = rejectedFields(error, firstAccountMessages)
        if (rejected) form.reject(rejected)
      },
    })
  }

  function skip() {
    setPressed('skip')
    creation.mutate(cashAccount(), {
      onSuccess: () => finish('현금 계좌를 만들었어요'),
      onError: (error) => {
        if (!isDuplicateName(error)) return
        // 다른 구성원이 먼저 "현금"을 만들었다. 장부에 계좌가 생겼으므로 안내를 마친다. 이 사람이 만든 것이 아니므로 토스트는 없다
        void queryClient.invalidateQueries({ queryKey: accountsKey(ledger.id) })
        finish()
      },
    })
  }

  /** 실패한 동작을 지금 화면의 값으로 다시 한다. 그동안 "다시 시도"는 사라지므로 그 동작의 버튼으로 초점을 옮긴다. */
  function retry() {
    if (pressed === 'create') {
      createButton.current?.focus()
      create()
    } else {
      skipButton.current?.focus()
      skip()
    }
  }

  return { form, busy, pressed, failed, create, skip, retry, createButton, skipButton }
}

function rejectedOnFields(error: Error): boolean {
  return rejectedFields(error, firstAccountMessages) !== undefined
}
