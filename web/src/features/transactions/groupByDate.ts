import type { ListedTransaction } from './transactions'

/** 날짜 묶음(0.5) 하나: 그날의 거래 */
export interface DayGroupData<T extends ListedTransaction = ListedTransaction> {
  /** `YYYY-MM-DD` */
  date: string
  items: T[]
}

/** 서버 순서 그대로 이어진 같은 날짜를 묶는다. 다시 정렬하지 않는다. */
export function groupByDate<T extends ListedTransaction>(items: T[]): DayGroupData<T>[] {
  const groups: DayGroupData<T>[] = []
  for (const item of items) {
    const last = groups.at(-1)
    if (last?.date === item.occurredOn) last.items.push(item)
    else groups.push({ date: item.occurredOn, items: [item] })
  }
  return groups
}
