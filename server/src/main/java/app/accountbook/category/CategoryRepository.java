package app.accountbook.category;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CategoryRepository extends JpaRepository<Category, UUID> {

    List<Category> findByLedgerIdOrderByCreatedAtAsc(UUID ledgerId);

    Optional<Category> findByLedgerIdAndKindAndSystemTrue(UUID ledgerId, CategoryKind kind);

    boolean existsByParentId(UUID parentId);
}
