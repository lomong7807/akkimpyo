import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation } from 'react-router'
import type { DraftForm } from '../../device/drafts'
import { registerKeeper, type Take } from './keepDraft'

/* 쓰던 값 보존의 등록(00-common 4.1, #234 C2). 등록부와 꺼내기는 keepDraft.ts에 있다. */

/**
 * 이 화면이 열려 있는 동안 로그인이 풀리면 남길 값을 등록한다. `take`는 바꾼 값이 없으면 undefined를 준다.
 * 주소는 지금 화면의 경로와 쿼리다.
 */
export function useKeepDraft(form: DraftForm, take: Take): void {
  const { pathname, search } = useLocation()
  const latest = useRef(take)
  useLayoutEffect(() => {
    latest.current = take
  })
  useEffect(() => registerKeeper(form, { path: pathname + search, take: () => latest.current() }), [form, pathname, search])
}
