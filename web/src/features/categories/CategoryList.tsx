import StatusChip from '../../components/StatusChip'
import type { Category } from './categories'
import styles from './CategoryList.module.css'

/**
 * 한 구분의 카테고리. 순서는 서버가 정하고 미분류만 맨 아래에 고정한다.
 * Safari는 목록 표시를 지운 ul을 목록으로 읽지 않으므로 role을 적어 들여쓰기의 뜻을 전한다.
 */
export default function CategoryList({ categories }: { categories: Category[] }) {
  return (
    <ul role="list" className={styles.list}>
      {categories
        .filter((category) => !category.system)
        .map(({ id, name, children }) => (
          <li key={id}>
            <Row name={name} />
            {children.length > 0 && (
              <ul role="list" className={`${styles.list} ${styles.children}`}>
                {children.map((child) => (
                  <li key={child.id}>
                    <Row name={child.name} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      {categories
        .filter((category) => category.system)
        .map(({ id, name }) => (
          <li key={id} className={styles.fixed}>
            <UncategorizedRow name={name} />
          </li>
        ))}
    </ul>
  )
}

function Row({ name }: { name: string }) {
  return (
    <div className={styles.row}>
      <span className={styles.name}>{name}</span>
    </div>
  )
}

function UncategorizedRow({ name }: { name: string }) {
  return (
    <div className={`${styles.row} ${styles.uncategorized}`}>
      <div className={styles.text}>
        <div className={styles.name}>{name}</div>
        <div className={styles.helper}>이름을 바꾸거나 지울 수 없어요</div>
      </div>
      <StatusChip>기본</StatusChip>
    </div>
  )
}
