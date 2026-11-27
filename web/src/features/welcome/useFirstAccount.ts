import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useToast } from '../../components/ToastContext'
import { today } from '../../lib/calendarDate'
import { accountAddMessages, toNewAccount, type AccountMessages } from '../accounts/accountForm'
import { isDuplicateName, rejectedFields } from '../accounts/accountRejection'
import type { NewAccount } from '../accounts/accounts'
import { accountsKey } from '../accounts/useAccounts'
import { useAccountForm } from '../accounts/useAccountForm'
import { useCreateAccount } from '../accounts/useCreateAccount'
import { CREATE_ACCOUNT, failureTextOf } from '../connection/offlineAction'
import { useConnection } from '../connection/useConnection'
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

/** 보내는 동안 도는 표시를 둘 버튼: 누른 동작의 버튼, 또는 실패 문구의 "다시 시도" */
type Sender = Action | 'retry'

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
  // 두 동작 모두 계좌를 만드는 요청이라 연결이 없으면 누를 수 없다(C-02 네트워크 오류)
  const online = useConnection() === 'online'
  // 마지막으로 보낸 동작. "다시 시도"가 이것을 다시 한다
  const [action, setAction] = useState<Action>('create')
  // 누른 버튼만 돌고 다른 버튼은 누를 수 없다(00-common 4.5, designer 규칙 #102)
  const [sender, setSender] = useState<Sender>('create')
  // 버튼 위의 실패 문구. 다시 보내는 동안에도 남기고, 실패마다 올려 새로 그려 다시 읽히게 한다. 없으면 없다.
  // 칸에 보인 거부와, 계좌가 생긴 것으로 보는 거부는 실패가 아니다
  const [failure, setFailure] = useState<{ count: number; text: string }>()

  const busy = creation.isPending || creation.isSuccess

  // 안내를 떠난 뒤에 온 응답으로는 불리지 않는다
  function finish(message?: string) {
    if (message) showToast(message)
    navigate(HOME, { replace: true })
  }

  /** 실패 문구를 새로 그린다. 연결이 끊긴 것과 그 밖을 나눈다(00-common 4.3) */
  function fail(error: Error) {
    setFailure((last) => ({ count: (last?.count ?? 0) + 1, text: failureTextOf(error, CREATE_ACCOUNT) }))
  }

  function create(from: Sender = 'create') {
    // 엔터로 보내는 길도 막는다(버튼은 누를 수 없게만 둔다)
    if (busy || !online) return
    if (!form.checkAll()) {
      creation.reset()
      setFailure(undefined)
      return
    }
    setAction('create')
    setSender(from)
    creation.mutate(toNewAccount(form.values), {
      onSuccess: () => finish('계좌를 만들었어요'),
      onError: (error) => {
        const rejected = rejectedFields(error, firstAccountMessages)
        if (rejected) {
          form.reject(rejected)
          setFailure(undefined)
        } else fail(error)
      },
    })
  }

  function skip(from: Sender = 'skip') {
    if (busy || !online) return
    setAction('skip')
    setSender(from)
    creation.mutate(cashAccount(), {
      onSuccess: () => finish('현금 계좌를 만들었어요'),
      onError: (error) => {
        if (!isDuplicateName(error)) {
          fail(error)
          return
        }
        // 다른 구성원이 먼저 "현금"을 만들었다. 장부에 계좌가 생겼으므로 안내를 마친다. 이 사람이 만든 것이 아니므로 토스트는 없다
        void queryClient.invalidateQueries({ queryKey: accountsKey(ledger.id) })
        finish()
      },
    })
  }

  /** 실패한 동작을 지금 화면의 값으로 다시 한다. 그동안 문구는 남고 "다시 시도"만 돈다. */
  function retry() {
    if (action === 'create') create('retry')
    else skip('retry')
  }

  // 누른 버튼의 이벤트가 보낸 버튼(from)으로 들어가지 않게 감싼다
  return { form, busy, online, sender, failure, create: () => create(), skip: () => skip(), retry }
}
