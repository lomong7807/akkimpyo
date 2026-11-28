import { useEffect, useRef, useState, type RefObject } from 'react'
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query'
import RetryMessage from '../../components/RetryMessage'
import Skeleton from '../../components/Skeleton'
import { RowsSkeleton } from './TransactionListSkeleton'
import type { TransactionPage } from './transactions'
import styles from './TransactionList.module.css'

/** 목록 끝이 화면 아래로 한 화면 높이 안에 들어오면 다음 쪽을 요청한다(00-common 5.10). */
const NEAR_END = '0px 0px 100% 0px'

/** 쪽으로 받는 거래 목록(내역의 한 달, 달력의 하루) */
export type PagedList = UseInfiniteQueryResult<InfiniteData<TransactionPage>, Error>

interface ListEndProps {
  list: PagedList
  /** 줄 목록. 다시 시도할 때 마지막 줄로 초점을 옮긴다. */
  rows: RefObject<HTMLDivElement | null>
}

/**
 * 목록 끝(00-common 5.10). 끝이 가까워지면 다음 쪽을 요청하고, 그동안 뼈대 줄 3개, 실패하면 "더 불러오지 못했어요"와
 * "다시 시도"를 보인다. 받으면 받은 건수를 화면 읽기에 알린다. 받는 중이거나 실패한 뒤에는 저절로 다시 요청하지 않는다.
 */
export default function ListEnd({ list, rows }: ListEndProps) {
  const target = useRef<HTMLDivElement>(null)
  const [nearEnd, setNearEnd] = useState(false)
  const { hasNextPage, isFetching, isFetchNextPageError, isFetchingNextPage, fetchNextPage } = list
  const pages = list.data?.pages ?? []

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setNearEnd(entry.isIntersecting), { rootMargin: NEAR_END })
    observer.observe(target.current!)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (nearEnd && hasNextPage && !isFetching && !isFetchNextPageError) void fetchNextPage({ cancelRefetch: false })
  }, [nearEnd, hasNextPage, isFetching, isFetchNextPageError, fetchNextPage])

  // 쪽이 늘면 새로 받은 건수를 알린다. 같은 글이 이어져도 다시 읽히도록 매번 새 요소로 넣는다
  const [pageCount, setPageCount] = useState(pages.length)
  const [loaded, setLoaded] = useState<{ count: number; message: string }>()
  if (pages.length !== pageCount) {
    setPageCount(pages.length)
    if (pages.length > pageCount) {
      setLoaded({ count: (loaded?.count ?? 0) + 1, message: `${pages.at(-1)!.items.length}건을 더 불러왔어요` })
    }
  }

  function retry() {
    // 누른 버튼이 사라지므로 마지막 줄로 초점을 옮겨, 받은 뒤 다음 Tab이 새 줄로 이어지게 한다
    const links = rows.current?.querySelectorAll<HTMLElement>('li > a')
    links?.item(links.length - 1)?.focus()
    if (!isFetching) void fetchNextPage({ cancelRefetch: false })
  }

  return (
    <>
      <div ref={target} />
      {isFetchingNextPage && (
        <Skeleton>
          <RowsSkeleton count={3} />
        </Skeleton>
      )}
      {isFetchNextPageError && !isFetchingNextPage && (
        <div className={styles.moreFailure}>
          <RetryMessage onRetry={retry}>더 불러오지 못했어요</RetryMessage>
        </div>
      )}
      <p className={styles.announcement} aria-live="polite">
        {loaded && <span key={loaded.count}>{loaded.message}</span>}
      </p>
    </>
  )
}
