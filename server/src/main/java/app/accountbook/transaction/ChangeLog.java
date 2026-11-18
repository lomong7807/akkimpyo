package app.accountbook.transaction;

import app.accountbook.common.BaseEntity;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** 거래 변경 이력. 추가만 하고 고치거나 지우지 않는다. 전후 값은 TransactionView의 JSON이다. */
@Entity
@Table(name = "change_log")
public class ChangeLog extends BaseEntity {

    @Column(name = "transaction_id", nullable = false, updatable = false)
    private UUID transactionId;

    @Column(name = "ledger_id", nullable = false, updatable = false)
    private UUID ledgerId;

    @Enumerated(EnumType.STRING)
    @Column(name = "action", nullable = false, updatable = false)
    private ChangeAction action;

    @Column(name = "actor_id", nullable = false, updatable = false)
    private UUID actorId;

    @Column(name = "device_id", updatable = false)
    private String deviceId;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "before_value", updatable = false)
    private JsonNode beforeValue;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "after_value", updatable = false)
    private JsonNode afterValue;

    protected ChangeLog() {
    }

    private ChangeLog(UUID transactionId, UUID ledgerId, ChangeAction action, UUID actorId, String deviceId,
                      JsonNode beforeValue, JsonNode afterValue, Instant createdAt) {
        super(UUID.randomUUID(), createdAt);
        this.transactionId = transactionId;
        this.ledgerId = ledgerId;
        this.action = action;
        this.actorId = actorId;
        this.deviceId = deviceId;
        this.beforeValue = beforeValue;
        this.afterValue = afterValue;
    }

    public static ChangeLog of(UUID transactionId, UUID ledgerId, ChangeAction action, UUID actorId,
                               String deviceId, JsonNode beforeValue, JsonNode afterValue, Instant createdAt) {
        return new ChangeLog(transactionId, ledgerId, action, actorId, deviceId, beforeValue, afterValue, createdAt);
    }

    public UUID getTransactionId() {
        return transactionId;
    }

    public UUID getLedgerId() {
        return ledgerId;
    }

    public ChangeAction getAction() {
        return action;
    }

    public UUID getActorId() {
        return actorId;
    }

    public String getDeviceId() {
        return deviceId;
    }

    public JsonNode getBeforeValue() {
        return beforeValue;
    }

    public JsonNode getAfterValue() {
        return afterValue;
    }
}
