import type { ReactNode } from 'react'
import Skeleton, { SkeletonBar } from './Skeleton'
import styles from './FieldsSkeleton.module.css'

/** 전체 화면 입력이 고칠 값을 받는 동안의 뼈대(거래 수정 D-04, 계좌 수정 G-02). 안에 칸 자리를 위에서부터 둔다. */
export default function FieldsSkeleton({ children }: { children: ReactNode }) {
  return (
    <Skeleton>
      <div className={styles.skeleton}>{children}</div>
    </Skeleton>
  )
}

/** 입력칸 하나의 자리: 이름 막대 아래 입력칸 모양 */
export function FieldSkeleton() {
  return (
    <div className={styles.fieldSkeleton}>
      <span className={styles.line}>
        <SkeletonBar kind="name" text="label" />
      </span>
      <span className={styles.fieldBox} />
    </div>
  )
}

/** 바꿀 수 없어 글자로만 보이는 칸의 자리: 이름 막대 아래 값 막대 */
export function ValueSkeleton() {
  return (
    <div className={styles.fieldSkeleton}>
      <span className={styles.line}>
        <SkeletonBar kind="name" text="label" />
      </span>
      <span className={styles.line}>
        <SkeletonBar kind="name" text="body" />
      </span>
    </div>
  )
}
