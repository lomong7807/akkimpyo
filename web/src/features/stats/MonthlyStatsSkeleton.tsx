import { MonthNavigationSpace } from '../../components/MonthNavigationSpace'
import Skeleton, { SkeletonBar } from '../../components/Skeleton'
import styles from './MonthlyStats.module.css'

/*
 * 월별 통계(E-01)의 뼈대. 화면 코드를 받는 동안의 틀(screens.tsx)이 쓰므로 첫 화면 JS에 든다. 첫 묶음에 이미 있는 것
 * (Skeleton, MonthNavigationSpace)만 쓰고, 화면 코드(MonthlyStatsPage)는 부르지 않는다.
 */

/** 불러오는 중(E 공통): 합계 세 줄과 카테고리 줄 3개. 실제와 같은 CSS로 놓아 내용으로 바뀔 때 밀리지 않는다. */
export default function MonthlyStatsSkeleton() {
  return (
    <Skeleton>
      <div className={styles.totals}>
        {[0, 1, 2].map((index) => (
          <div key={index} className={styles.total}>
            <SkeletonBar kind="name" text="body" />
            <SkeletonBar kind="amount" text="body" />
          </div>
        ))}
      </div>
      <div className={styles.top}>
        <div className={styles.topHead}>
          <SkeletonBar kind="name" text="body" />
        </div>
        <div className={styles.topList}>
          {[0, 1, 2].map((index) => (
            <div key={index} className={styles.topRow}>
              <span className={styles.topName}>
                <SkeletonBar kind="name" text="body" />
              </span>
              <span className={styles.topAmount}>
                <SkeletonBar kind="amount" text="body" />
              </span>
            </div>
          ))}
        </div>
      </div>
    </Skeleton>
  )
}

/** 화면 코드를 받는 동안(#251): 달 이동 자리를 비워 두고 그 아래에 뼈대를 둔다. 배치는 화면과 같다. */
export function MonthlyStatsShell() {
  return (
    <div className={styles.stats}>
      <div className={styles.monthNavigation}>
        <MonthNavigationSpace />
      </div>
      <MonthlyStatsSkeleton />
    </div>
  )
}
