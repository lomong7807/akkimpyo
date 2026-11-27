package app.accountbook.transaction;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
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

    /**
     * 거래와 라인을 한 문장으로 읽는다. 한 문장은 한 시점의 값을 보므로, 거래와 라인을 따로 읽을 때처럼 그사이 커밋된
     * 수정이나 완전 삭제가 섞이지 않는다(#202). 영속성 컨텍스트에 이미 있는 거래는 DB 값으로 바꾸지 않고 그것을 주므로,
     * 한 시점의 값이라는 것은 그 트랜잭션에서 그 거래를 처음 읽을 때만이다.
     */
    @EntityGraph(attributePaths = "lines")
    Optional<Transaction> findWithLinesById(UUID id);

    /** 그 장부에 있는 거래인가. 휴지통의 거래도 있다. 완전히 지운 거래는 행이 없다. */
    boolean existsByIdAndLedgerId(UUID id, UUID ledgerId);

    /** 그 카테고리들의 라인이 있는 거래(휴지통, 취소 포함)를 잠근다(#3). 그 거래를 고치는 요청은 이 커밋을 기다린다. */
    @Query(value = """
            select t.id from transaction t where t.ledger_id = :ledgerId
               and t.id in (select l.transaction_id from transaction_line l where l.category_id in (:categoryIds))
             order by t.id for update
            """, nativeQuery = true)
    List<UUID> lockUsingCategories(UUID ledgerId, Collection<UUID> categoryIds);

    /** 그 카테고리들의 라인이 있는 거래를 라인 전부와 함께 읽는다. */
    @Query("""
            select t from Transaction t join fetch t.lines where t.ledgerId = :ledgerId
               and t.id in (select l.transaction.id from TransactionLine l where l.categoryId in :categoryIds)
            """)
    List<Transaction> findWithLinesUsingCategories(UUID ledgerId, Collection<UUID> categoryIds);

    /** 그 카테고리들의 라인이 있는 거래의 version을 1씩 올린다. 라인을 옮기기 전에 부른다. */
    @Modifying(flushAutomatically = true)
    @Query("""
            update Transaction t set t.version = t.version + 1, t.updatedAt = :updatedAt where t.ledgerId = :ledgerId
               and t.id in (select l.transaction.id from TransactionLine l where l.categoryId in :categoryIds)
            """)
    int advanceVersionsUsingCategories(UUID ledgerId, Collection<UUID> categoryIds, Instant updatedAt);
}
