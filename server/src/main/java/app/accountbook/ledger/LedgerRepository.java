package app.accountbook.ledger;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface LedgerRepository extends JpaRepository<Ledger, UUID> {
}
