import { createContext } from 'react'

/** 넓은 화면 내역(D-01 (13))의 오른쪽 칸에 연 상세가 칸을 다루는 것. 내역이 준다. 한 칸 상세에는 없다. */
export interface DetailPane {
  /** 그 거래를 삭제한 뒤 칸을 안내 문구로 되돌린다. 초점은 다음 줄, 없으면 이전 줄, 없으면 달 이름이다(designer #102). */
  closeAfterDelete: () => void
}

export const DetailPaneContext = createContext<DetailPane | undefined>(undefined)
