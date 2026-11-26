import { useId, type ReactNode, type Ref } from 'react'
import { Button } from '../../components/Button'
import LoadFailure from '../../components/LoadFailure'
import { LoadingStatus, SkeletonSpace } from '../../components/Skeleton'
import StatusChip from '../../components/StatusChip'
import { useLoadingMessage } from '../../components/useLoadingMessage'
import type { Category, CategoryKind } from '../categories/categories'
import { useCategories } from '../categories/useCategories'
import WelcomeStep from './WelcomeStep'
import styles from './Welcome.module.css'

const kinds: { kind: CategoryKind; name: string }[] = [
  { kind: 'EXPENSE', name: '지출' },
  { kind: 'INCOME', name: '수입' },
]

/** 뼈대 막대의 수: 다섯 개씩 두 줄 */
const bars = Array.from({ length: 10 }, (_, index) => index)

interface CategoriesStepProps {
  heading: Ref<HTMLHeadingElement>
  onNext: () => void
}

/** 첫 장: 장부에 들어 있는 기본 카테고리(C-02 (1)~(6)). 여기서는 고치지 않는다. */
export default function CategoriesStep({ heading, onNext }: CategoriesStepProps) {
  return (
    <WelcomeStep
      step={1}
      title="기본 카테고리를 넣어 두었어요"
      heading={heading}
      bottom={
        <Button kind="primary" onClick={onNext}>
          다음
        </Button>
      }
    >
      <CategoryGroups />
      <p className={styles.note}>카테고리는 나중에 카테고리 관리에서 고칠 수 있어요.</p>
    </WelcomeStep>
  )
}

/** 지출과 수입. 불러오는 동안 소제목은 그대로 두고 칩 자리에만 뼈대를 둔다. */
function CategoryGroups() {
  const { data, isFetchedAfterMount, isFetching, refetch } = useCategories()
  const message = useLoadingMessage()
  // 다시 받는 동안에는 isError가 풀리므로 이 화면에서 받아 본 적이 있는지로 본다
  if (!data && isFetchedAfterMount) {
    return <LoadFailure headingLevel={2} onRetry={() => void refetch()} busy={isFetching} />
  }
  return (
    <>
      {!data && <LoadingStatus message={message} />}
      {kinds.map(({ kind, name }) => (
        <Group key={kind} name={name}>
          {(headingId) =>
            data ? (
              <Chips labelledBy={headingId} categories={data.filter((category) => category.kind === kind)} />
            ) : (
              <SkeletonSpace shown={message !== undefined}>
                <div className={styles.chipBars}>
                  {bars.map((bar) => (
                    <span key={bar} className={styles.chipBar} />
                  ))}
                </div>
              </SkeletonSpace>
            )
          }
        </Group>
      ))}
    </>
  )
}

function Group({ name, children }: { name: string; children: (headingId: string) => ReactNode }) {
  const headingId = useId()
  return (
    <div className={styles.group}>
      <h2 id={headingId} className={styles.groupTitle}>
        {name}
      </h2>
      {children(headingId)}
    </div>
  )
}

/**
 * 최상위 카테고리를 서버가 준 순서대로 둔다(미분류 포함). 이름은 사용자가 고칠 수 있어 길면 칩 안에서 줄을 바꾼다.
 * Safari는 점을 없앤 목록을 목록으로 알리지 않으므로 role을 적는다.
 */
function Chips({ labelledBy, categories }: { labelledBy: string; categories: Category[] }) {
  return (
    <ul role="list" aria-labelledby={labelledBy} className={styles.chips}>
      {categories.map(({ id, name }) => (
        <li key={id}>
          <StatusChip wrap>{name}</StatusChip>
        </li>
      ))}
    </ul>
  )
}
