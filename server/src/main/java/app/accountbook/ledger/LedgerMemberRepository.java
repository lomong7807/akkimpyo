package app.accountbook.ledger;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface LedgerMemberRepository extends JpaRepository<LedgerMember, UUID> {

    boolean existsByLedgerIdAndUserId(UUID ledgerId, UUID userId);

    Optional<LedgerMember> findByLedgerIdAndUserId(UUID ledgerId, UUID userId);

    List<LedgerMember> findByUserId(UUID userId);

    /** 사용자가 구성원인 장부의 이름과 권한을 한 번에 읽는다. 먼저 속한 장부가 앞이고, 같은 시각이면 장부 id 순이다. */
    @Query("""
            select new app.accountbook.ledger.LedgerMembership(l.id, l.name, m.role)
              from LedgerMember m join Ledger l on l.id = m.ledgerId
             where m.userId = :userId
             order by m.createdAt, l.id
            """)
    List<LedgerMembership> findMemberships(UUID userId);
}
