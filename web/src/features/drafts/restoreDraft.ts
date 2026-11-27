import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation } from 'react-router'
import { sessionUserId } from '../../api/session'
import { readDraft, removeDraft } from '../../device/draftReads'
import type { DraftForm } from '../../device/drafts'

/*
 * 남긴 쓰던 값을 입력 화면에 채운다(00-common 4.1, #234 C2). 저장은 사용자가 다시 누른다. 입력 화면(따로 싣는 화면)만 쓰므로
 * 남기기(keepDraft.ts, 첫 화면 묶음)와 나눈다.
 */

/**
 * 지금 사용자가 이 주소에서 남긴 쓰던 값이 있으면 `restore`로 채우고 지운다. `ready`가 될 때(채울 칸이 준비될 때) 한 번 본다.
 * 다른 사용자의 것은 읽지 않고(키의 첫 칸), 다른 주소에서 남긴 것은 채우지 않고 남긴다.
 */
export function useRestoredDraft(form: DraftForm, restore: (values: unknown) => void, ready = true): void {
  const { pathname, search } = useLocation()
  const latest = useRef(restore)
  useLayoutEffect(() => {
    latest.current = restore
  })
  useEffect(() => {
    const user = sessionUserId()
    if (!ready || user === undefined) return
    let current = true
    readDraft(user, form).then(
      (draft) => {
        if (!current || draft === undefined || draft.path !== pathname + search) return
        latest.current(draft.values)
        void removeDraft(user, form).catch(() => {})
      },
      () => {},
    )
    return () => {
      current = false
    }
  }, [form, pathname, search, ready])
}
