import { ApiError } from '../../api/apiError'
import { request } from '../../api/request'
import { ledgerPath } from '../me/ledgerPath'

/* 카테고리의 경로와 필드 이름(#34의 응답 계약)은 이 파일에만 있다. */

const kinds = ['EXPENSE', 'INCOME'] as const

export type CategoryKind = (typeof kinds)[number]

interface SubCategory {
  id: string
  name: string
}

/** 최상위 카테고리 */
export interface Category extends SubCategory {
  kind: CategoryKind
  /** 미분류. 이름으로 판단하지 않는다. */
  system: boolean
  children: SubCategory[]
}

/** 장부의 최상위 카테고리. 순서는 서버가 정한다. 실패하면 ApiError를 던진다. */
export async function fetchCategories(ledgerId: string): Promise<Category[]> {
  const body = await request<{ items?: unknown } | null | undefined>(ledgerPath(ledgerId, 'categories'))
  const items = body?.items
  if (!Array.isArray(items) || !items.every(isCategory)) throw ApiError.unreadable()
  return items
}

function isCategory(value: Partial<Category> | null): value is Category {
  return (
    isSubCategory(value) &&
    kinds.some((kind) => kind === value.kind) &&
    typeof value.system === 'boolean' &&
    Array.isArray(value.children) &&
    value.children.every(isSubCategory)
  )
}

function isSubCategory<T extends Partial<SubCategory>>(value: T | null): value is T & SubCategory {
  return typeof value?.id === 'string' && typeof value.name === 'string'
}
