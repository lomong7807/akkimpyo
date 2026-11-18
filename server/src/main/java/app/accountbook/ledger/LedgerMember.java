package app.accountbook.ledger;

import app.accountbook.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.util.UUID;

@Entity
@Table(name = "ledger_member")
public class LedgerMember extends BaseEntity {

    @Column(name = "ledger_id", nullable = false, updatable = false)
    private UUID ledgerId;

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Enumerated(EnumType.STRING)
    @Column(name = "role", nullable = false)
    private LedgerRole role;

    protected LedgerMember() {
    }

    private LedgerMember(UUID ledgerId, UUID userId, LedgerRole role) {
        super(UUID.randomUUID());
        this.ledgerId = ledgerId;
        this.userId = userId;
        this.role = role;
    }

    public static LedgerMember of(UUID ledgerId, UUID userId, LedgerRole role) {
        return new LedgerMember(ledgerId, userId, role);
    }

    public UUID getLedgerId() {
        return ledgerId;
    }

    public UUID getUserId() {
        return userId;
    }

    public LedgerRole getRole() {
        return role;
    }
}
