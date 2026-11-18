package app.accountbook.transaction;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface TransactionRepository extends JpaRepository<Transaction, UUID> {

    /**
     * version이 expectedVersion일 때만 1 올린다. 영향 행 수가 0이면 낡은 요청이다.
     * 행 잠금 덕분에 같은 version으로 동시에 들어온 요청 중 하나만 1을 받는다.
     */
    @Modifying(flushAutomatically = true)
    @Query("""
            update Transaction t
               set t.version = t.version + 1, t.updatedAt = :updatedAt
             where t.id = :id and t.version = :expectedVersion
            """)
    int advanceVersion(@Param("id") UUID id, @Param("expectedVersion") long expectedVersion,
                       @Param("updatedAt") Instant updatedAt);

    @EntityGraph(attributePaths = "lines")
    List<Transaction> findByLedgerIdAndDeletedAtIsNotNullOrderByDeletedAtDesc(UUID ledgerId);
}
