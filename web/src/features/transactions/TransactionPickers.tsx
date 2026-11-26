import type { UseQueryResult } from '@tanstack/react-query'
import type { ReactNode, Ref } from 'react'
import EmptyState from '../../components/EmptyState'
import LoadFailure from '../../components/LoadFailure'
import OptionList, { type PickerSection } from '../../components/OptionList'
import PickerField from '../../components/PickerField'
import { useLoadingMessage } from '../../components/useLoadingMessage'
import { accountTypes, type Account } from '../accounts/accounts'
import { accountTypeNames } from '../accounts/accountTypeNames'
import { useAccounts } from '../accounts/useAccounts'
import type { Category, CategoryKind } from '../categories/categories'
import { useCategories } from '../categories/useCategories'
import styles from './TransactionNew.module.css'

/** 카테고리 칸이 비었을 때 보이는 이름(D-04 (5)). 미분류로 저장한다. */
const UNCATEGORIZED = '미분류'

interface PickerProps {
  value: string
  onChange: (value: string) => void
  readOnly: boolean
  error?: string
  ref?: Ref<HTMLButtonElement>
}

/** 카테고리(D-04 (5)). 그 유형의 구분만 나오고 상위와 하위 모두 고를 수 있다. 미분류는 맨 아래이고 빈 값이다. */
export function CategoryField({ kind, value, onChange, ...field }: PickerProps & { kind: CategoryKind }) {
  const categories = useCategories()
  const valueText = value === '' ? UNCATEGORIZED : (categoryName(categories.data ?? [], value) ?? '')
  return (
    <PickerField label="카테고리" optional valueText={valueText} {...field}>
      {({ close, focusVisible }) => (
        <PickerState query={categories}>
          {(data) => (
            <OptionList
              label="카테고리"
              searchLabel="카테고리 이름 찾기"
              sections={categorySections(data, kind)}
              value={value}
              focusVisible={focusVisible}
              startAtFirst={value === ''}
              onSelect={(next) => {
                onChange(next)
                close()
              }}
            />
          )}
        </PickerState>
      )}
    </PickerField>
  )
}

interface AccountFieldProps extends PickerProps {
  label: string
  help?: string
}

/** 계좌(D-04 (6), (17), (18)). 은행, 카드, 현금 묶음이고 줄에는 이름만 있다. 1A에는 숨긴 계좌가 없다. */
export function AccountField({ label, value, onChange, ...field }: AccountFieldProps) {
  const accounts = useAccounts()
  const valueText = accounts.data?.find((account) => account.id === value)?.name ?? ''
  return (
    <PickerField label={label} valueText={valueText} {...field}>
      {({ close, focusVisible }) => (
        <PickerState query={accounts}>
          {(data) =>
            data.length === 0 ? (
              <div className={styles.pickerMessage}>
                <EmptyState description="고를 수 있는 계좌가 없어요. 더보기의 계좌에서 계좌를 추가하거나 숨긴 계좌를 다시 보이게 해 주세요." />
              </div>
            ) : (
              <OptionList
                label={label}
                // 0.8에서 이름 찾기 칸은 카테고리 판에만 있다(designer 검토)
                searchable={false}
                sections={accountSections(data)}
                value={value}
                focusVisible={focusVisible}
                onSelect={(next) => {
                  onChange(next)
                  close()
                }}
              />
            )
          }
        </PickerState>
      )}
    </PickerField>
  )
}

/** 판 안의 불러오는 중, 불러오지 못함(F-904). 받은 목록이 있으면 그것을 보인다. */
function PickerState<T>({ query, children }: { query: UseQueryResult<T>; children: (data: T) => ReactNode }) {
  if (query.data !== undefined) return children(query.data)
  if (query.errorUpdateCount > 0) {
    return <LoadFailure headingLevel={2} onRetry={() => void query.refetch()} busy={query.isFetching} />
  }
  return <PickerLoading />
}

function PickerLoading() {
  const message = useLoadingMessage()
  return (
    <p role="status" className={styles.pickerMessage}>
      {message}
    </p>
  )
}

/** 고른 카테고리의 이름. 하위면 하위 이름만이다(D 0.4). 목록에 없으면 없다. */
function categoryName(categories: Category[], id: string): string | undefined {
  for (const category of categories) {
    if (category.id === id) return category.name
    const child = category.children.find((each) => each.id === id)
    if (child) return child.name
  }
}

function categorySections(categories: Category[], kind: CategoryKind): PickerSection[] {
  const ofKind = categories.filter((category) => category.kind === kind)
  const made = ofKind.filter((category) => !category.system)
  const uncategorized = ofKind.find((category) => category.system)
  return [
    {
      options: [
        ...made.map(({ id, name, children }) => ({
          value: id,
          label: name,
          children: children.map((child) => ({ value: child.id, label: child.name })),
        })),
        // 미분류는 맨 아래이고 고르면 칸을 비운다(서버가 미분류로 저장한다)
        { value: '', label: uncategorized?.name ?? UNCATEGORIZED },
      ],
    },
  ]
}

function accountSections(accounts: Account[]): PickerSection[] {
  return accountTypes
    .map((type) => ({
      heading: accountTypeNames[type],
      options: accounts.filter((account) => account.type === type).map(({ id, name }) => ({ value: id, label: name })),
    }))
    .filter(({ options }) => options.length > 0)
}
