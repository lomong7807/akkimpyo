import FieldsSkeleton, { FieldSkeleton } from '../../components/FieldsSkeleton'

/** 입력칸 모양의 뼈대: 이름, 종류, 시작 잔액, 기준일(G-02 수정 모드 불러오는 중, designer #243 D2) */
export default function AccountFieldsSkeleton() {
  return (
    <FieldsSkeleton>
      <FieldSkeleton />
      <FieldSkeleton />
      <FieldSkeleton />
      <FieldSkeleton />
    </FieldsSkeleton>
  )
}
