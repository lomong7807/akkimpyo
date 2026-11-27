package app.accountbook.user;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface UserRepository extends JpaRepository<User, UUID> {

    boolean existsByEmail(String email);

    Optional<User> findByEmail(String email);

    /** 장부의 구성원인 사용자를 한 번에 읽는다. */
    @Query("select u from User u join LedgerMember m on m.userId = u.id where m.ledgerId = :ledgerId")
    List<User> findMembersOf(UUID ledgerId);
}
