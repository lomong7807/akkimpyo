/*
 * 한 줄 입력의 따로 싣는 조각(oneLineChunk)을 받는 곳(#233). 한 번 받으면 탭이 닫힐 때까지 둔다. 받지 못하면 남기지 않고 다음에
 * 다시 받는다.
 */

export type OneLineChunk = typeof import('./oneLineChunk')

let loaded: OneLineChunk | undefined
let loading: Promise<OneLineChunk> | undefined
const arrivals = new Set<(chunk: OneLineChunk) => void>()

/** 받아 둔 조각. 아직 없으면 없다 */
export function loadedChunk(): OneLineChunk | undefined {
  return loaded
}

export function loadChunk(): Promise<OneLineChunk> {
  loading ??= import('./oneLineChunk').then(
    (chunk) => {
      loaded = chunk
      arrivals.forEach((arrive) => arrive(chunk))
      return chunk
    },
    (error: unknown) => {
      loading = undefined
      throw error
    },
  )
  return loading
}

/** 조각이 오면 부른다. 그만 들으려면 돌려준 함수를 부른다 */
export function onChunkArrived(listener: (chunk: OneLineChunk) => void): () => void {
  arrivals.add(listener)
  return () => void arrivals.delete(listener)
}

/** 홈이 한가할 때(LedgerLayout의 preloadWhenIdle)나 입력칸에 초점이 가면 미리 받는다. 받지 못해도 알리지 않는다 */
export const oneLinePreload = { preload: () => void loadChunk().catch(() => {}) }
