import styles from './MonthNavigation.module.css'

/**
 * 달 이동을 그리기 전의 자리(#251). 같은 높이를 비워 두어 달 이동이 나타날 때 아래 내용이 밀리지 않는다.
 * 따로 싣는 화면의 틀이 쓰므로 첫 화면 JS에 든다. 달 이동(MonthNavigation)은 화면 조각에 남게 파일을 나눈다(#355).
 */
export function MonthNavigationSpace() {
  return <div aria-hidden="true" className={styles.navigation} />
}
