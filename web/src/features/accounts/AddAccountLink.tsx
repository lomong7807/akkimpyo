import { ButtonLink } from '../../components/Button'
import { openedFromList } from './openedFromList'

/** 계좌 추가(G-02)를 여는 링크. 계좌 목록의 상단 바와 빈 상태가 쓰고, 목록을 받는 동안의 틀(#251)도 같은 것을 둔다. */
export default function AddAccountLink({ kind, children }: { kind: 'text' | 'primary'; children: string }) {
  return (
    <ButtonLink kind={kind} to="/accounts/new" state={openedFromList}>
      {children}
    </ButtonLink>
  )
}
