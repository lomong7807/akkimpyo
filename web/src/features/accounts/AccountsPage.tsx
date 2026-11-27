import { useId } from 'react'
import Amount from '../../components/Amount'
import EmptyState from '../../components/EmptyState'
import { SubScreen } from '../../components/Screen'
import BasisTime from '../connection/BasisTime'
import { useShown } from '../connection/deviceFirst'
import LoadFailureHere from '../connection/LoadFailureHere'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { useKeptCopy } from '../me/ledgerCopy'
import { accountTypes, parseAccounts, type Account } from './accounts'
import AddAccountLink from './AddAccountLink'
import AccountsSkeleton from './AccountsSkeleton'
import { accountTypeNames } from './accountTypeNames'
import { accountsKey, useAccounts } from './useAccounts'
import styles from './Accounts.module.css'

/**
 * G-01 계좌 목록. 1A에서 계좌 줄은 눌리지 않는다. 계좌 상세(G-03)가 들어오면 맞춘다.
 * 기기에 남긴 계좌 목록이 있으면 받는 동안 먼저 보이고(00-common 4.5), 연결이 없거나 받지 못하면 그것을 읽기 전용으로 보이며
 * 자산 합계 위에 기준 시각을 붙인다(F-908).
 */
export default function AccountsPage() {
  return (
    <SubScreen title="계좌" parent="/more" action={<AddAccountLink kind="text">추가</AddAccountLink>}>
      <Accounts />
    </SubScreen>
  )
}

function Accounts() {
  const ledger = useCurrentLedger()
  const query = useAccounts()
  const shown = useShown(query, accountsKey(ledger.id), useKeptCopy(ledger.id, 'accounts', parseAccounts))
  if (shown.state === 'ready') return <AccountList accounts={shown.data} basis={shown.basis} />
  if (shown.state === 'failed') {
    return <LoadFailureHere headingLevel={2} onRetry={() => void query.refetch()} busy={query.isFetching} />
  }
  return <AccountsSkeleton />
}

/** 계좌 목록. `basis`가 있으면 (2) 자산 합계 줄 바로 위에 기준 시각을 붙인다(F-908). */
function AccountList({ accounts, basis }: { accounts: Account[]; basis: number | undefined }) {
  if (accounts.length === 0) {
    return (
      <EmptyState description="계좌가 없어요. 계좌를 추가하면 잔액을 한눈에 볼 수 있어요.">
        <AddAccountLink kind="primary">계좌 추가</AddAccountLink>
      </EmptyState>
    )
  }
  return (
    <div className={styles.accounts}>
      {/* 기준 시각은 자산 합계 줄 바로 위 오른쪽 한 줄이다(내역의 합계와 같다, designer #238) */}
      {basis !== undefined && (
        <p className={styles.basis}>
          <BasisTime at={basis} />
        </p>
      )}
      <p className={`${styles.row} ${styles.total}`}>
        <span className={styles.name}>자산 합계</span>
        <Balance value={sumOf(accounts)} />
      </p>
      {accountTypes.map((type) => (
        <AccountGroup key={type} name={accountTypeNames[type]} accounts={accounts.filter((each) => each.type === type)} />
      ))}
    </div>
  )
}

function AccountGroup({ name, accounts }: { name: string; accounts: Account[] }) {
  const headingId = useId()
  if (accounts.length === 0) return null
  return (
    <div className={styles.group}>
      <div className={`${styles.row} ${styles.head}`}>
        <h2 id={headingId} className={styles.name}>
          {name}
        </h2>
        <Balance value={sumOf(accounts)} />
      </div>
      {/* Safari는 점을 없앤 목록을 목록으로 알리지 않으므로 role을 적는다 */}
      <ul role="list" aria-labelledby={headingId} className={styles.list}>
        {accounts.map((account) => (
          <li key={account.id} className={`${styles.row} ${styles.account}`}>
            <span className={styles.name}>{account.name}</span>
            <Balance value={account.balance} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function Balance({ value }: { value: number }) {
  return (
    <span className={styles.amount}>
      <Amount kind="balance" value={value} />
    </span>
  )
}

function sumOf(accounts: Account[]): number {
  return accounts.reduce((sum, { balance }) => sum + balance, 0)
}
