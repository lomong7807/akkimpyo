package app.accountbook.category;

import app.accountbook.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.util.UUID;

@Entity
@Table(name = "category")
public class Category extends BaseEntity {

    public static final String UNCATEGORIZED_NAME = "미분류";

    @Column(name = "ledger_id", nullable = false, updatable = false)
    private UUID ledgerId;

    @Enumerated(EnumType.STRING)
    @Column(name = "kind", nullable = false, updatable = false)
    private CategoryKind kind;

    @Column(name = "name", nullable = false)
    private String name;

    /** 상위 분류. null이면 최상위 분류다. 카테고리는 2단계까지다. */
    @Column(name = "parent_id", updatable = false)
    private UUID parentId;

    /** 장부마다 자동으로 생기는 기본 카테고리(미분류). 이름 변경과 삭제가 안 된다. */
    @Column(name = "system", nullable = false, updatable = false)
    private boolean system;

    protected Category() {
    }

    private Category(UUID ledgerId, CategoryKind kind, String name, UUID parentId, boolean system) {
        super(UUID.randomUUID());
        this.ledgerId = ledgerId;
        this.kind = kind;
        this.name = name;
        this.parentId = parentId;
        this.system = system;
    }

    public static Category of(UUID ledgerId, CategoryKind kind, String name, UUID parentId) {
        return new Category(ledgerId, kind, name, parentId, false);
    }

    public static Category uncategorized(UUID ledgerId, CategoryKind kind) {
        return new Category(ledgerId, kind, UNCATEGORIZED_NAME, null, true);
    }

    public void rename(String name) {
        this.name = name;
    }

    public UUID getLedgerId() {
        return ledgerId;
    }

    public CategoryKind getKind() {
        return kind;
    }

    public String getName() {
        return name;
    }

    public UUID getParentId() {
        return parentId;
    }

    public boolean isSystem() {
        return system;
    }

    public boolean isTopLevel() {
        return parentId == null;
    }
}
