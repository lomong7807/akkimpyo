import Skeleton, { SkeletonBar } from '../../components/Skeleton'
import styles from './Accounts.module.css'

/** 자산 합계 한 줄, 묶음 머리 3개, 묶음마다 계좌 줄 2개 */
export default function AccountsSkeleton() {
  return (
    <Skeleton>
      <div className={styles.accounts}>
        <div className={`${styles.row} ${styles.total}`}>
          <SkeletonBar kind="name" text="body" />
          <SkeletonBar kind="amount" text="title" />
        </div>
        <GroupSkeleton />
        <GroupSkeleton />
        <GroupSkeleton />
      </div>
    </Skeleton>
  )
}

function GroupSkeleton() {
  return (
    <div className={styles.group}>
      <div className={`${styles.row} ${styles.head}`}>
        <SkeletonBar kind="name" text="label" />
        <SkeletonBar kind="amount" text="body" />
      </div>
      <AccountSkeleton />
      <AccountSkeleton />
    </div>
  )
}

function AccountSkeleton() {
  return (
    <div className={`${styles.row} ${styles.account}`}>
      <SkeletonBar kind="name" text="body" />
      <SkeletonBar kind="amount" text="body" />
    </div>
  )
}
