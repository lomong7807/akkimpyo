import Skeleton, { SkeletonBar } from '../../components/Skeleton'
import styles from './Categories.module.css'

const rows = Array.from({ length: 8 }, (_, index) => index)

/** 카테고리 줄 8개. 유형 고르기는 응답을 기다리지 않으므로 뼈대가 없다. */
export default function CategoriesSkeleton() {
  return (
    <Skeleton>
      {rows.map((row) => (
        <div key={row} className={styles.row}>
          <SkeletonBar kind="name" text="body" />
        </div>
      ))}
    </Skeleton>
  )
}
