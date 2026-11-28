import type { Account } from '../accounts/accounts'
import type { Category } from '../categories/categories'
import { isUncategorized } from './formDefaults'
import { nameBookOf, type NameBook } from './listedText'
import { savedTransactionValues, type TransactionValues } from './transactionForm'
import type { TransactionDetail } from './transactions'

/** 선택 판(IdConflictChoice, #239·#280)의 비교에 쓰는 그 장부의 계좌·카테고리 이름과, 저장된 거래를 칸의 값으로 바꾸는 법(미분류는 빈 칸) */
export interface ChoiceLists {
  names: NameBook
  valuesOf: (saved: TransactionDetail) => TransactionValues
}

export function choiceListsOf(accounts: Account[], categories: Category[]): ChoiceLists {
  return {
    names: nameBookOf(accounts, categories),
    valuesOf: (saved) => savedTransactionValues(saved, (categoryId) => isUncategorized(categories, categoryId)),
  }
}
