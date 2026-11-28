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

    List<Category> findByLedgerIdAndParentId(UUID ledgerId, UUID parentId);

    /**
     * 지울 카테고리를 FOR UPDATE로 잠근다(F-512). FK 확인(FOR KEY SHARE)과 부딪혀 커밋까지 이것을 가리키는 라인이나 하위가 생기지
     * 않는다. JPA의 비관적 쓰기 잠금은 PostgreSQL에서 FOR NO KEY UPDATE라 그것을 막지 못해 SQL로 적는다.
     */
    @Query(value = "select * from category where id = :id and ledger_id = :ledgerId for update", nativeQuery = true)
    Optional<Category> lockForDelete(UUID ledgerId, UUID id);

    /** 상위를 잠근 다음 문장이라, 잠그기 전에 들어와 그 뒤에 커밋된 하위도 본다. */
    @Query(value = "select * from category where parent_id = :parentId and ledger_id = :ledgerId order by id for update",
            nativeQuery = true)
    List<Category> lockChildrenForDelete(UUID ledgerId, UUID parentId);

    /** 가리킬 카테고리를 FK 확인과 같은 FOR KEY SHARE로 읽는다. 지우는 중이면 그 커밋을 기다리고, 지워졌으면 비어 있다. */
    @Query(value = "select * from category where id = :id and ledger_id = :ledgerId for key share", nativeQuery = true)
    Optional<Category> findForReference(UUID ledgerId, UUID id);

    /** 같은 장부·구분·상위(최상위끼리는 parentId가 null)에 같은 이름의 다른 카테고리가 있는가. */
    @Query("""
            select count(c) > 0 from Category c
            where c.ledgerId = :ledgerId and c.kind = :kind and c.name = :name
              and c.parentId is not distinct from :parentId
              and c.id <> :selfId
            """)
    boolean existsSibling(UUID ledgerId, CategoryKind kind, UUID parentId, String name, UUID selfId);
}
