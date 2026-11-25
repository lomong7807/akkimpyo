import { useState } from 'react'
import LoadFailure from '../../components/LoadFailure'
import { SubScreen } from '../../components/Screen'
import SegmentedChoice from '../../components/SegmentedChoice'
import type { CategoryKind } from './categories'
import CategoryList from './CategoryList'
import styles from './CategoriesPage.module.css'
import { useCategories } from './useCategories'

const kindOptions: { value: CategoryKind; label: string }[] = [
  { value: 'EXPENSE', label: '지출' },
  { value: 'INCOME', label: '수입' },
]

/** H-01 카테고리. 1A는 보기만 한다. 추가, 이름 바꾸기, 삭제는 1C에서 넣는다. */
export default function CategoriesPage() {
  const [kind, setKind] = useState<CategoryKind>('EXPENSE')
  return (
    <SubScreen title="카테고리" parent="/more">
      <div className={styles.kind}>
        <SegmentedChoice label="구분" options={kindOptions} value={kind} onChange={setKind} />
      </div>
      <Categories kind={kind} />
    </SubScreen>
  )
}

function Categories({ kind }: { kind: CategoryKind }) {
  const { data, isFetchedAfterMount, isFetching, refetch } = useCategories()
  if (data) return <CategoryList categories={data.filter((category) => category.kind === kind)} />
  // 다시 받는 동안에는 isError가 풀리므로 이 화면에서 받아 본 적이 있는지로 본다
  if (isFetchedAfterMount) return <LoadFailure onRetry={() => void refetch()} busy={isFetching} />
  return null
}
