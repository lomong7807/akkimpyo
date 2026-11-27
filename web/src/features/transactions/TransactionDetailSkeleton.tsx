import Skeleton, { SkeletonBar } from '../../components/Skeleton'
import styles from './TransactionDetail.module.css'

/** 주소로 바로 연 때의 뼈대: (2)~(10) 자리. 유형·금액, 가맹점, 항목 5줄이다. */
export function DetailSkeleton() {
  return (
    <Skeleton>
      <div className={styles.detail}>
        <div className={styles.summary}>
          <div className={styles.head}>
            <SkeletonBar kind="name" text="body" />
            <SkeletonBar kind="amount" text="title" />
          </div>
          <div className={`${styles.payee} ${styles.lineSkeleton}`}>
            <SkeletonBar kind="name" text="body" />
          </div>
        </div>
        <div className={styles.list}>
          <FieldsSkeleton count={5} />
        </div>
      </div>
    </Skeleton>
  )
}

/** 항목 줄 모양의 뼈대 */
export function FieldsSkeleton({ count }: { count: number }) {
  return Array.from({ length: count }, (_, index) => (
    <div key={index} className={styles.item}>
      <SkeletonBar kind="name" text="body" />
      <SkeletonBar kind="amount" text="body" />
    </div>
  ))
}
