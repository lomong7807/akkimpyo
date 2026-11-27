package app.accountbook.user;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface UserRepository extends JpaRepository<User, UUID> {

    boolean existsByEmail(String email);

    Optional<User> findByEmail(String email);

    /** 사용자 행을 FOR SHARE로 잠그고 저장값을 읽는다. 엔터티가 아니라 값을 받아, 영속성 컨텍스트가 아닌 잠근 뒤의 값이다. */
    @Query(value = "select password_hash from users where id = :id for share", nativeQuery = true)
    Optional<String> lockPasswordHash(@Param("id") UUID id);

    /** 장부의 구성원인 사용자를 한 번에 읽는다. */
    @Query("select u from User u join LedgerMember m on m.userId = u.id where m.ledgerId = :ledgerId")
    List<User> findMembersOf(UUID ledgerId);
}
