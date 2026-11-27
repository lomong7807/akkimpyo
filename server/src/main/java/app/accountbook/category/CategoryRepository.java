package app.accountbook.category;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface CategoryRepository extends JpaRepository<Category, UUID> {

    List<Category> findByLedgerIdOrderByCreatedAtAsc(UUID ledgerId);

    /** 카테고리 목록의 순서(#34, dba 메모 PR #136): 미분류(system)가 뒤, 다음은 만든 시각, 같으면 id. */
    List<Category> findByLedgerIdOrderBySystemAscCreatedAtAscIdAsc(UUID ledgerId);

    Optional<Category> findByLedgerIdAndKindAndSystemTrue(UUID ledgerId, CategoryKind kind);

    boolean existsByParentId(UUID parentId);

    /** 같은 장부·구분·상위(최상위끼리는 parentId가 null)에 같은 이름의 다른 카테고리가 있는가. */
    @Query("""
            select count(c) > 0 from Category c
            where c.ledgerId = :ledgerId and c.kind = :kind and c.name = :name
              and c.parentId is not distinct from :parentId
              and c.id <> :selfId
            """)
    boolean existsSibling(UUID ledgerId, CategoryKind kind, UUID parentId, String name, UUID selfId);
}
