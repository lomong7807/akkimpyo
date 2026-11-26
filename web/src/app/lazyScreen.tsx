import { createElement, useEffect, useState, type ComponentType, type ReactNode } from 'react'
import LoadFailure from '../components/LoadFailure'
import { ShellShownContext } from '../components/shellShown'

/** 화면 코드를 받지 못해 새로고침했다는 이 탭의 표시. 새로고침은 한 탭에서 한 번만 하고, 화면 코드를 받으면 지운다(architect #251). */
const RELOADED = 'akkimpyo-screen-reload'

export interface ScreenShell {
  /** 그 화면과 같은 상단 바. 내용 자리에 children을 둔다. */
  Frame: ComponentType<{ children: ReactNode }>
  /** 화면 코드를 받는 동안 내용 자리에 두는 것. 그 화면의 뼈대다. */
  Placeholder: ComponentType
  /** 받지 못한 안내의 제목 단계. 상단 바에 화면 이름(h1)이 있으면 2다. */
  headingLevel?: 1 | 2
}

export interface LazyScreen {
  /** 라우트의 element로 그린다. */
  Screen: ComponentType
  /** 화면 코드를 미리 받는다. 받지 못해도 알리지 않고, 화면을 열 때 다시 받는다. */
  preload: () => void
}

/**
 * 따로 싣는 화면(#251). 화면 코드는 처음 열 때나 미리 받을 때 `load`(동적 import)로 받는다.
 * 받는 동안 그 화면의 상단 바와 뼈대(`shell`)를 그린다. 공통 틀과 하단 탭은 바깥이라 그대로다.
 * 받아 둔 화면은 틀 없이 바로 그린다.
 *
 * Suspense를 쓰지 않는다. React 19는 fallback을 보인 경계의 내용을 fallback을 보인 때부터 300ms가 지나야 보인다
 * (react-dom 19.3.1의 FALLBACK_THROTTLE_MS). 작은 화면 코드가 20ms에 와도 내용 자리가 300ms 비어 있게 된다.
 *
 * 받지 못하면(연결 없음, 배포로 화면 코드 파일이 없어짐) 틀 안에 "불러오지 못했어요."(F-907)를 둔다. 다시 시도는 같은 파일을
 * 다시 받고, 연결이 있는데도 또 받지 못하면 새 index.html을 받으러 새로고침한다(한 탭에 한 번).
 */
export function lazyScreen(load: () => Promise<{ default: ComponentType }>, shell: ScreenShell): LazyScreen {
  let loaded: ComponentType | undefined
  let loading: Promise<ComponentType> | undefined

  function fetchScreen(): Promise<ComponentType> {
    loading ??= load().then(
      (module) => {
        loaded = module.default
        forgetReload()
        return loaded
      },
      (error: unknown) => {
        // 실패는 남기지 않는다. 다음에 열거나 다시 시도하면 새로 받는다
        loading = undefined
        throw error
      },
    )
    return loading
  }

  function Screen() {
    // 처음 그릴 때 받아 둔 코드가 없었으면 틀을 먼저 보인 것이다
    const [afterShell] = useState(() => loaded === undefined)
    const [screen, setScreen] = useState(() => loaded)
    const [failed, setFailed] = useState(false)
    const [retrying, setRetrying] = useState(false)

    useEffect(() => {
      if (screen) return
      fetchScreen().then(
        (component) => setScreen(() => component),
        () => setFailed(true),
      )
    }, [screen])

    function retry() {
      setRetrying(true)
      fetchScreen().then(
        (component) => setScreen(() => component),
        () => {
          // 연결이 있는데도 또 받지 못하면 배포로 파일이 바뀐 것으로 본다
          if (navigator.onLine !== false && reloadOnce()) return
          setRetrying(false)
        },
      )
    }

    if (screen) {
      const content = createElement(screen)
      return afterShell ? <ShellShownContext value>{content}</ShellShownContext> : content
    }
    const { Frame, Placeholder, headingLevel } = shell
    return (
      <Frame>
        {failed ? <LoadFailure headingLevel={headingLevel} busy={retrying} onRetry={retry} /> : <Placeholder />}
      </Frame>
    )
  }

  return {
    Screen,
    preload() {
      fetchScreen().catch(() => {})
    },
  }
}

/** 이 탭에서 아직 새로고침하지 않았으면 새로고침한다. 저장소가 막혀 있으면 되풀이를 막을 수 없으므로 하지 않는다. */
function reloadOnce(): boolean {
  try {
    if (window.sessionStorage.getItem(RELOADED) !== null) return false
    window.sessionStorage.setItem(RELOADED, '1')
  } catch {
    return false
  }
  window.location.reload()
  return true
}

function forgetReload() {
  try {
    window.sessionStorage.removeItem(RELOADED)
  } catch {
    // 막혀 있으면 표시를 남길 수도 없었다
  }
}
