import { SegmentedChoiceSpace } from '../../components/SegmentedChoice'
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

/** 카테고리의 코드를 받는 동안(#251): 유형 고르기 자리를 비워 두고 그 아래에 줄의 뼈대를 둔다. 배치는 카테고리 화면과 같다. */
export function CategoriesScreenSkeleton() {
  return (
    <>
      <div className={styles.kind}>
        <SegmentedChoiceSpace />
      </div>
      <CategoriesSkeleton />
    </>
  )
}
