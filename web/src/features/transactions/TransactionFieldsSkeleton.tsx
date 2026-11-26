import Skeleton, { SkeletonBar } from '../../components/Skeleton'
import styles from './TransactionEdit.module.css'

/** 입력칸 모양의 뼈대: 유형(값 글자)과 위쪽 칸 다섯(금액, 가맹점/내용, 카테고리, 계좌, 날짜) */
export default function TransactionFieldsSkeleton() {
  return (
    <Skeleton>
      <div className={styles.skeleton}>
        <div className={styles.fieldSkeleton}>
          <span className={styles.line}>
            <SkeletonBar kind="name" text="label" />
          </span>
          <span className={styles.line}>
            <SkeletonBar kind="name" text="body" />
          </span>
        </div>
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className={styles.fieldSkeleton}>
            <span className={styles.line}>
              <SkeletonBar kind="name" text="label" />
            </span>
            <span className={styles.fieldBox} />
          </div>
        ))}
      </div>
    </Skeleton>
  )
}
