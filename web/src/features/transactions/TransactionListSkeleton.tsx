import Skeleton, { SkeletonBar } from '../../components/Skeleton'
import styles from './TransactionList.module.css'

/**
 * 첫 불러오기의 뼈대(D-01 상태): 합계 두 줄, 날짜 묶음 머리 1개, 거래 줄 5개. 실제와 같은 줄을 같은 CSS로 놓고 글자
 * 자리에 막대를 두어, 내용으로 바뀔 때 합계와 첫 묶음이 밀리지 않는다. 넓은 화면의 합계는 실제처럼 한 줄이다.
 */
export default function TransactionListSkeleton() {
  return (
    <Skeleton>
      <div className={styles.totals}>
        <div className={`${styles.total} ${styles.totalSkeleton}`}>
          <SkeletonBar kind="name" text="body" />
          <SkeletonBar kind="amount" text="body" />
        </div>
        <div className={`${styles.total} ${styles.totalSkeleton}`}>
          <SkeletonBar kind="name" text="body" />
          <SkeletonBar kind="amount" text="body" />
        </div>
      </div>
      <DayHeadSkeleton />
      <RowsSkeleton count={5} />
    </Skeleton>
  )
}

/** 날짜 묶음 머리 모양의 뼈대. 날짜와 그날 합계 자리에 막대를 둔다. */
export function DayHeadSkeleton() {
  return (
    <div className={styles.dayHead}>
      <SkeletonBar kind="name" text="label" />
      <SkeletonBar kind="amount" text="label" />
    </div>
  )
}

/** 거래 줄 모양의 뼈대. 시각 칸은 비우고 제목과 금액, 둘째 줄에 막대를 둔다. */
export function RowsSkeleton({ count }: { count: number }) {
  return Array.from({ length: count }, (_, index) => (
    <div key={index} className={styles.row}>
      <span className={styles.time} />
      <span className={styles.body}>
        <span className={styles.first}>
          <SkeletonBar kind="name" text="body" />
          <SkeletonBar kind="amount" text="body" />
        </span>
        <span className={`${styles.detail} ${styles.detailSkeleton}`}>
          <SkeletonBar kind="name" text="label" />
        </span>
      </span>
    </div>
  ))
}
