/// <reference lib="webworker" />
import { serveApp } from './serveApp'

/*
 * dist/sw.js의 시작점(#234 C). 빌드 플러그인(plugins/serviceWorkerPlugin.ts)이 아래 두 값을 넣고 다른 것을 부르지 않는
 * classic script 하나로 묶는다(module service worker는 브라우저 지원이 고르지 않다).
 */

/** 미리 캐시할 빌드 결과(/index.html, /assets/…, /manifest.webmanifest, /icons/…) */
declare const __PRECACHE__: string[]
/** 이 판의 캐시 이름(akkimpyo-app-{내용 해시}). 빌드 결과가 바뀌면 바뀌어 새 판이 설치된다 */
declare const __CACHE_NAME__: string

serveApp(self as unknown as ServiceWorkerGlobalScope, __PRECACHE__, __CACHE_NAME__)
