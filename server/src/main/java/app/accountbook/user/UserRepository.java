package app.accountbook.user;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface UserRepository extends JpaRepository<User, UUID> {

    boolean existsByEmail(String email);

    Optional<User> findByEmail(String email);

    /** 사용자 행을 FOR SHARE로 잠그고 저장값을 읽는다. 엔터티가 아니라 값을 받아, 영속성 컨텍스트가 아닌 잠근 뒤의 값이다. */
    @Query(value = "select password_hash from users where id = :id for share", nativeQuery = true)
    Optional<String> lockPasswordHash(@Param("id") UUID id);

    /** 비밀번호 바꾸기(#31): 사용자 행을 FOR NO KEY UPDATE로 잠그고 저장값을 읽는다. 로그인의 FOR SHARE와 서로 기다린다. */
    @Query(value = "select password_hash from users where id = :id for no key update", nativeQuery = true)
    Optional<String> lockPasswordHashForChange(@Param("id") UUID id);

    @Modifying
    @Query(value = "update users set password_hash = :hash where id = :id", nativeQuery = true)
    void updatePasswordHash(@Param("id") UUID id, @Param("hash") String hash);

    /**
     * 표시 이름 칸만 고친다. 고친 행의 수(없는 사용자면 0)다. 엔터티를 저장하면 모든 칸을 다시 쓰므로, 읽은 뒤에 바뀐 비밀번호 해시를
     * 읽었던 값으로 되돌릴 수 있다. 앞의 변경은 먼저 내보내고, 영속성 컨텍스트를 비워 이어서 읽는 값이 고친 뒤의 값이게 한다.
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update User u set u.displayName = :displayName where u.id = :id")
    int updateDisplayName(@Param("id") UUID id, @Param("displayName") String displayName);

    /** 장부의 구성원인 사용자를 한 번에 읽는다. */
    @Query("select u from User u join LedgerMember m on m.userId = u.id where m.ledgerId = :ledgerId")
    List<User> findMembersOf(UUID ledgerId);
}
