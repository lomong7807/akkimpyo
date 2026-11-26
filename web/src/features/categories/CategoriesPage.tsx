import { useState } from 'react'
import { SubScreen } from '../../components/Screen'
import SegmentedChoice from '../../components/SegmentedChoice'
import { useShown } from '../connection/deviceFirst'
import LoadFailureHere from '../connection/LoadFailureHere'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { useKeptCopy } from '../me/ledgerCopy'
import { parseCategories, type CategoryKind } from './categories'
import CategoriesSkeleton from './CategoriesSkeleton'
import CategoryList from './CategoryList'
import { categoriesKey, useCategories } from './useCategories'
import styles from './Categories.module.css'

const kindOptions: { value: CategoryKind; label: string }[] = [
  { value: 'EXPENSE', label: '지출' },
  { value: 'INCOME', label: '수입' },
]

/**
 * H-01 카테고리. 1A는 보기만 한다. 추가, 이름 바꾸기, 삭제는 1C에서 넣는다.
 * 기기에 남긴 카테고리가 있으면 받는 동안 먼저 보이고(00-common 4.5), 연결이 없거나 받지 못하면 그것을 읽기 전용으로 보인다
 * (F-908). 합계가 없는 화면이라 기준 시각은 붙이지 않는다(N-03 (5)).
 */
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
  const ledger = useCurrentLedger()
  const query = useCategories()
  const shown = useShown(query, categoriesKey(ledger.id), useKeptCopy(ledger.id, 'categories', parseCategories))
  if (shown.state === 'ready') return <CategoryList categories={shown.data.filter((category) => category.kind === kind)} />
  if (shown.state === 'failed') {
    return <LoadFailureHere headingLevel={2} onRetry={() => void query.refetch()} busy={query.isFetching} />
  }
  return <CategoriesSkeleton />
}
