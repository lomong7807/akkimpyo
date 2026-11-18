package app.accountbook.transaction;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ChangeLogRepository extends JpaRepository<ChangeLog, UUID> {

    List<ChangeLog> findByTransactionIdOrderByCreatedAtAsc(UUID transactionId);

    Optional<ChangeLog> findFirstByTransactionIdOrderByCreatedAtDesc(UUID transactionId);
}
