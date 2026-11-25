import { ListButton, ListGroup } from '../../components/ListRow'
import { MainScreen } from '../../components/Screen'
import styles from './MorePage.module.css'

/** M-01 더보기. 로그아웃은 1A 동안 맨 아래 묶음에 둔다. 프로필(M-02)이 들어오면 그 화면으로 옮긴다. */
export default function MorePage({ onLogout }: { onLogout: () => void }) {
  return (
    <MainScreen>
      <div className={styles.groups}>
        <ListGroup>
          <ListButton icon="SignOut" onClick={onLogout}>
            로그아웃
          </ListButton>
        </ListGroup>
      </div>
    </MainScreen>
  )
}
