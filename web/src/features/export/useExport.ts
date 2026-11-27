import { useMutation } from '@tanstack/react-query'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { exportLedger, type ExportRequest } from './exportFile'

export interface ExportStart {
  request: ExportRequest
  /** 누른 사용자. 보내기 직전과 받은 뒤의 사용자가 다르면 보내거나 저장하지 않는다 */
  user: string | undefined
}

/** 현재 장부의 거래를 파일로 받아 저장한다(K-01 (5)). 다시 보내는 것은 사용자가 누른다. */
export function useExport() {
  const ledger = useCurrentLedger()
  return useMutation({
    mutationFn: ({ request, user }: ExportStart) => exportLedger(ledger, request, user),
  })
}
