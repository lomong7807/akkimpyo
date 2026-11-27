import { useMatches } from 'react-router'
import type { ScreenHandle } from './navigation'

/** 지금 화면의 라우트에 적은 것. 안쪽 라우트에 적은 것이 바깥쪽에 적은 것보다 앞선다. */
export function useScreenHandle(): ScreenHandle {
  return Object.assign({}, ...useMatches().map((match) => match.handle as ScreenHandle | undefined))
}
