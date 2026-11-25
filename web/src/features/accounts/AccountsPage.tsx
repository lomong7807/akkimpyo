import { useId } from 'react'
import Amount from '../../components/Amount'
import EmptyState from '../../components/EmptyState'
import LoadFailure from '../../components/LoadFailure'
import { SubScreen } from '../../components/Screen'
import { accountTypes, type Account, type AccountType } from './accounts'
import AccountsSkeleton from './AccountsSkeleton'
import { useAccounts } from './useAccounts'
import styles from './Accounts.module.css'

const typeNames: Record<AccountType, string> = { BANK: '은행', CARD: '카드', CASH: '현금' }

/** G-01 계좌 목록. 1A에서 계좌 줄은 눌리지 않는다. 계좌 상세(G-03)가 들어오면 맞춘다. */
export default function AccountsPage() {
  return (
    <SubScreen title="계좌" parent="/more">
      <Accounts />
    </SubScreen>
  )
}

function Accounts() {
  const { data, isFetchedAfterMount, isFetching, refetch } = useAccounts()
  if (data) return <AccountList accounts={data} />
  // 다시 받는 동안에는 isError가 풀리므로 이 화면에서 받아 본 적이 있는지로 본다
  if (isFetchedAfterMount) return <LoadFailure headingLevel={2} onRetry={() => void refetch()} busy={isFetching} />
  return <AccountsSkeleton />
}

function AccountList({ accounts }: { accounts: Account[] }) {
  if (accounts.length === 0) {
    return <EmptyState description="계좌가 없어요. 계좌를 추가하면 잔액을 한눈에 볼 수 있어요." />
  }
  return (
    <div className={styles.accounts}>
      <p className={`${styles.row} ${styles.total}`}>
        <span className={styles.name}>자산 합계</span>
        <Balance value={sumOf(accounts)} />
      </p>
      {accountTypes.map((type) => (
        <AccountGroup key={type} name={typeNames[type]} accounts={accounts.filter((each) => each.type === type)} />
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
