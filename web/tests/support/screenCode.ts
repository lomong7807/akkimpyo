import { beforeAll, vi } from 'vitest'

/*
 * 앱과 따로 싣는 화면의 코드(#251)를 파일마다 처음 받는 일을 테스트 밖에서 먼저 끝낸다(#291).
 *
 * vitest는 파일마다 모듈을 새로 받는다. 파일에서 처음 여는 앱과 화면은 그 코드(모듈 그래프)를 vitest 본 프로세스에서 받아 오고,
 * 그 뒤 테스트는 앱을 새로 열어도(vi.resetModules) 받아 둔 코드를 다시 실행만 한다. 그래서 파일의 첫 테스트만 코드를 받는 데
 * 수십~수백 ms를 더 쓰고(뒤 테스트는 몇 ms), 부하에서는 그 시간이 앱의 반응을 기다리는 한도(findBy·waitFor 1초)와 테스트 한도
 * (5초) 안에 들어가 첫 테스트가 칸을 못 찾거나 시간을 넘겼다. 받는 시간은 앱이 아니라 테스트를 돌리는 기기의 일이라 그 한도에서 뺀다.
 *
 * 받는 동안의 틀(lazyScreen)은 그대로 보인다. 여기서 받은 모듈은 첫 테스트가 앱을 새로 열 때 버려지고, 앱은 자기 화면 코드를
 * 처음 여는 것처럼 다시 받는다(받아 둔 코드를 실행만 하므로 빠르다).
 */

let registered = false

/** 이 파일의 테스트를 시작하기 전에 앱과 모든 화면의 코드를 받아 둔다. 앱 그리기 도우미가 불러올 때 부른다. 여러 번 불러도 한 번만 건다. */
export function fetchScreenCodeFirst() {
  if (registered) return
  registered = true
  beforeAll(async () => {
    // 테스트가 정적으로 불러 둔 앱 모듈과 섞이지 않게 앱을 새로 여는 것처럼 받는다
    vi.resetModules()
    // 공통 틀과 첫 묶음의 화면(routes가 정적으로 부르는 것)과 따로 싣는 화면을 모두 받는다
    await import('../../src/app/routes')
    const screens = await import('../../src/app/screens')
    for (const screen of Object.values(screens)) screen.preload()
    // 받는 중인 모듈이 모두 실행될 때까지 기다린다. 실제 시계로 기다리고 한도는 이 hook의 시간 한도다
    await vi.dynamicImportSettled()
  })
}
