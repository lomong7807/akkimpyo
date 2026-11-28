package app.accountbook.transaction;

import java.util.Collection;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface TransactionLineRepository extends JpaRepository<TransactionLine, UUID> {

    /** 소프트 삭제·취소된 거래의 라인도 포함한다. */
    boolean existsByAccountId(UUID accountId);

    /** 소프트 삭제·취소된 거래의 라인도 포함한다. */
    boolean existsByCategoryId(UUID categoryId);

    /** 그 카테고리들을 쓰는 거래 수(F-512). 소프트 삭제·취소된 거래도 센다. */
    @Query("""
            select count(distinct l.transaction.id) from TransactionLine l
             where l.ledgerId = :ledgerId and l.categoryId in :categoryIds
            """)
    long countTransactionsUsingCategories(UUID ledgerId, Collection<UUID> categoryIds);

    /** 그 카테고리들의 라인을 한 문장으로 옮긴다(#3). 엔터티의 category_id는 고칠 수 없는 칸이라 SQL로 적는다. */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            update transaction_line set category_id = :targetCategoryId
             where ledger_id = :ledgerId and category_id in (:categoryIds)
            """, nativeQuery = true)
    int moveCategory(UUID ledgerId, Collection<UUID> categoryIds, UUID targetCategoryId);
}
