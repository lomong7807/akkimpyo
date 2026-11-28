import FieldsSkeleton, { FieldSkeleton, ValueSkeleton } from '../../components/FieldsSkeleton'

/** 입력칸 모양의 뼈대: 유형(값 글자)과 위쪽 칸 다섯(금액, 가맹점/내용, 카테고리, 계좌, 날짜) */
export default function TransactionFieldsSkeleton() {
  return (
    <FieldsSkeleton>
      <ValueSkeleton />
      {Array.from({ length: 5 }, (_, index) => (
        <FieldSkeleton key={index} />
      ))}
    </FieldsSkeleton>
  )
}
