/// <reference lib="webworker" />
import { turnOffApp } from './turnOffApp'

/*
 * dist/sw-off.js의 시작점(긴급히 끄기, devops #52·#54). 빌드 플러그인이 sw.js와 같은 방식으로 다른 것을 부르지 않는 classic
 * script 하나로 묶는다. 미리 캐시하지 않는다.
 */

turnOffApp(self as unknown as ServiceWorkerGlobalScope)
