package app.accountbook.transaction;

import app.accountbook.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import tools.jackson.databind.JsonNode;

/** 거래 변경 이력. 추가만 하고 고치거나 지우지 않는다. 전후 값은 {@link ChangeLogValue}의 JSON이다. */
@Entity
@Table(name = "change_log")
public class ChangeLog extends BaseEntity {

    @Column(name = "transaction_id", nullable = false, updatable = false)
    private UUID transactionId;

    @Column(name = "ledger_id", nullable = false, updatable = false)
    private UUID ledgerId;

    /** 그 변경 뒤의 거래 version. 한 거래 안에서 겹치지 않고, 1씩 이어지지는 않는다(ADR 008 결정 10). */
    @Column(name = "version", nullable = false, updatable = false)
    private long version;

    @Enumerated(EnumType.STRING)
    @Column(name = "action", nullable = false, updatable = false)
    private ChangeAction action;

    /** 서버가 한 일과 탈퇴한 사람은 null이다(ADR 007 결정 5, 6). */
    @Column(name = "actor_id", updatable = false)
    private UUID actorId;

    @Column(name = "device_id", updatable = false)
    private String deviceId;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "before_value", updatable = false)
    private JsonNode beforeValue;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "after_value", updatable = false)
    private JsonNode afterValue;

    @Column(name = "format_version", nullable = false, updatable = false)
    private short formatVersion;

    protected ChangeLog() {
    }

    private ChangeLog(UUID transactionId, UUID ledgerId, long version, ChangeAction action, UUID actorId,
                      String deviceId, JsonNode beforeValue, JsonNode afterValue, Instant createdAt) {
        super(UUID.randomUUID(), createdAt);
        this.transactionId = transactionId;
        this.ledgerId = ledgerId;
        this.version = version;
        this.action = action;
        this.actorId = actorId;
        this.deviceId = deviceId;
        this.beforeValue = beforeValue;
        this.afterValue = afterValue;
        this.formatVersion = ChangeLogValue.FORMAT_VERSION;
    }

    /** 이력 행을 만드는 유일한 길이다. 기기 값은 여기서 목록의 값이나 unknown으로 바뀐다({@link DeviceIds#storable}). */
    public static ChangeLog of(UUID transactionId, UUID ledgerId, long version, ChangeAction action, UUID actorId,
                               String deviceId, ChangeLogValue before, ChangeLogValue after, Instant createdAt) {
        return new ChangeLog(transactionId, ledgerId, version, action, actorId, DeviceIds.storable(deviceId),
                toJson(before), toJson(after), createdAt);
    }

    private static JsonNode toJson(ChangeLogValue value) {
        return value == null ? null : value.toJson();
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
