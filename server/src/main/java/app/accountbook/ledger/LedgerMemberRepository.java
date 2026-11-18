package app.accountbook.ledger;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface LedgerMemberRepository extends JpaRepository<LedgerMember, UUID> {

    boolean existsByLedgerIdAndUserId(UUID ledgerId, UUID userId);

    Optional<LedgerMember> findByLedgerIdAndUserId(UUID ledgerId, UUID userId);

    List<LedgerMember> findByUserId(UUID userId);
}
