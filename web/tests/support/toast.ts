import { screen } from '@testing-library/react'

/**
 * 토스트의 알림 영역(ToastProvider의 .region). 공통 틀 안에는 연결 없음 띠의 알림 영역(#235)과 화면의 알림 줄(뼈대 안내 등)도
 * `role="status"`라 역할만으로는 고를 수 없다.
 */
export function toastRegion(): HTMLElement {
  const regions = screen.getAllByRole('status').filter((region) => /(^| )_region_/.test(region.className))
  if (regions.length !== 1) throw new Error(`토스트 알림 영역이 ${regions.length}개다`)
  return regions[0]
}
