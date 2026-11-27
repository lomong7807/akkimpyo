import { DownloadSimple, SignOut, Tag, Wallet } from '../../components/icons'
import { ListButton, ListGroup, ListLink } from '../../components/ListRow'
import { MainScreen } from '../../components/Screen'
import SyncedTime from '../sync/SyncedTime'
import styles from './MorePage.module.css'

/** M-01 더보기. 로그아웃은 1A 동안 맨 아래 묶음에 둔다. 프로필(M-02)이 들어오면 그 화면으로 옮긴다. 맨 아래에 마지막으로 맞춘 시각. */
export default function MorePage({ onLogout }: { onLogout: () => void }) {
  return (
    <MainScreen>
      <div className={styles.groups}>
        <ListGroup>
          <ListLink icon={Wallet} to="/accounts">
            계좌
          </ListLink>
          <ListLink icon={Tag} to="/categories">
            카테고리
          </ListLink>
          {/* (6) 1·2단계 이름은 "내보내기"다(F-901). 아이콘은 designer #240 D2 */}
          <ListLink icon={DownloadSimple} to="/export">
            내보내기
          </ListLink>
        </ListGroup>
        <ListGroup>
          <ListButton icon={SignOut} onClick={onLogout}>
            로그아웃
          </ListButton>
        </ListGroup>
      </div>
      {/* 마지막으로 맞춘 시각(M-01 (16)). 목록 맨 아래, 누를 수 없다 */}
      <SyncedTime className={styles.synced} />
    </MainScreen>
  )
}
