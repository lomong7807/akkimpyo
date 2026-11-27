import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation } from 'react-router'
import { keepDrafts, type Draft, type DraftForm } from '../../device/drafts'

/*
 * 쓰던 값 보존(00-common 4.1, #234 C2, 설계 7절).
 * - 입력 화면은 열려 있는 동안 useKeepDraft로 "지금 값 꺼내기"를 등록한다. 바꾼 값이 없으면 꺼낼 것이 없다(떠나기 확인과 같은 기준)
 * - 로그인이 풀리는 순간(ended) 로그인 영역(SessionProvider)이 takeDrafts로 등록된 화면의 값을 꺼내 그 사용자의 것으로 남긴다
 * - 같은 계정으로 다시 로그인해 같은 주소로 돌아오면 그 화면이 useRestoredDraft(restoreDraft.ts)로 읽어 채우고 지운다
 */

type Take = () => unknown

const keepers = new Map<DraftForm, { path: string; take: Take }>()

/** 열려 있는 입력 화면의 값을 꺼낸다. 바꾼 값이 없는 화면은 뺀다. 로그인이 풀린 순간 화면이 사라지기 전에 부른다. */
export function takeDrafts(at: number): Draft[] {
  const drafts: Draft[] = []
  for (const [form, { path, take }] of keepers) {
    const values = take()
    if (values !== undefined) drafts.push({ form, path, values, savedAt: at })
  }
  return drafts
}

/** 남기기를 이보다 오래 기다리지 않는다. 저장소가 막혀도 로그인 화면으로 가는 것이 늦어지지 않게 한다 */
const KEEP_WAIT_MS = 3000

/**
 * 로그인이 풀리는 순간 열린 입력 화면의 값을 그 사용자의 것으로 남긴다. 값은 부른 즉시 꺼낸다(화면이 사라지기 전).
 * 남길 것이 없으면 없다. 남겼으면 true, 저장소를 쓸 수 없거나 늦으면 false다(로그인 화면의 둘째 줄을 보이지 않는다).
 */
export function keepOpenDrafts(userId: string, at: number): Promise<boolean> | undefined {
  const drafts = takeDrafts(at)
  if (drafts.length === 0) return undefined
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), KEEP_WAIT_MS)
    keepDrafts(userId, drafts).then(
      () => resolve(true),
      () => resolve(false),
    ).finally(() => clearTimeout(timer))
  })
}

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
  useEffect(() => {
    const keeper = { path: pathname + search, take: () => latest.current() }
    keepers.set(form, keeper)
    return () => {
      if (keepers.get(form) === keeper) keepers.delete(form)
    }
  }, [form, pathname, search])
}
