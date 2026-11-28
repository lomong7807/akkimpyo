import styles from './SegmentedChoice.module.css'

/**
 * 유형 고르기를 그리기 전의 자리(#251). 같은 높이를 보이지 않게 비워 두어 고르기가 나타날 때 아래 내용이 밀리지 않는다.
 * 따로 싣는 화면의 틀이 쓰므로 첫 화면 JS에 든다. 고르기(SegmentedChoice)는 화면 조각에 남게 파일을 나눈다(#355).
 */
export function SegmentedChoiceSpace() {
  return <div aria-hidden="true" className={`${styles.box} ${styles.space}`} />
}
