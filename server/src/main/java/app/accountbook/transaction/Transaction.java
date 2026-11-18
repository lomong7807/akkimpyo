package app.accountbook.transaction;

import app.accountbook.common.BaseEntity;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.OneToMany;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

/**
 * 거래 헤더. 돈의 움직임은 분개 라인(lines)으로 저장한다.
 * version은 JPA @Version을 쓰지 않는다. 서비스가 조건부 UPDATE로 직접 비교·증가한다.
 */
@Entity
@Table(name = "transaction")
public class Transaction extends BaseEntity {

    public static final long INITIAL_VERSION = 1L;

    @Column(name = "ledger_id", nullable = false, updatable = false)
    private UUID ledgerId;

    @Enumerated(EnumType.STRING)
    @Column(name = "type", nullable = false, updatable = false)
    private TransactionType type;

    /** 장부 시간대의 현지 날짜. 집계 기준이다. */
    @Column(name = "occurred_on", nullable = false)
    private LocalDate occurredOn;

    /** 장부 시간대의 현지 시각. 없을 수 있다. */
    @Column(name = "occurred_time")
    private LocalTime occurredTime;

    @Column(name = "payee")
    private String payee;

    @Column(name = "memo")
    private String memo;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private TransactionStatus status;

    @Column(name = "created_by", nullable = false, updatable = false)
    private UUID createdBy;

    @Column(name = "paid_by")
    private UUID paidBy;

    @Column(name = "version", nullable = false)
    private long version;

    @Column(name = "deleted_at")
    private Instant deletedAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @OneToMany(mappedBy = "transaction", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<TransactionLine> lines = new ArrayList<>();

    protected Transaction() {
    }

    private Transaction(UUID id, UUID ledgerId, TransactionType type, LocalDate occurredOn, LocalTime occurredTime,
                        String payee, String memo, UUID createdBy, UUID paidBy) {
        super(id);
        this.ledgerId = ledgerId;
        this.type = type;
        this.occurredOn = occurredOn;
        this.occurredTime = occurredTime;
        this.payee = payee;
        this.memo = memo;
        this.status = TransactionStatus.POSTED;
        this.createdBy = createdBy;
        this.paidBy = paidBy;
        this.version = INITIAL_VERSION;
        this.updatedAt = getCreatedAt();
    }

    /** 새 거래. status는 POSTED, version은 1이다. 라인은 {@link #addLine}으로 붙인다. */
    public static Transaction of(UUID id, UUID ledgerId, TransactionType type, LocalDate occurredOn,
                                 LocalTime occurredTime, String payee, String memo, UUID createdBy, UUID paidBy) {
        return new Transaction(id, ledgerId, type, occurredOn, occurredTime, payee, memo, createdBy, paidBy);
    }

    public Transaction addLine(UUID accountId, UUID categoryId, long amount) {
        lines.add(TransactionLine.of(this, accountId, categoryId, amount));
        return this;
    }

    public UUID getLedgerId() {
        return ledgerId;
    }

    public TransactionType getType() {
        return type;
    }

    public LocalDate getOccurredOn() {
        return occurredOn;
    }

    public LocalTime getOccurredTime() {
        return occurredTime;
    }

    public String getPayee() {
        return payee;
    }

    public String getMemo() {
        return memo;
    }

    public TransactionStatus getStatus() {
        return status;
    }

    public UUID getCreatedBy() {
        return createdBy;
    }

    public UUID getPaidBy() {
        return paidBy;
    }

    public long getVersion() {
        return version;
    }

    public Instant getDeletedAt() {
        return deletedAt;
    }

    public boolean isDeleted() {
        return deletedAt != null;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public List<TransactionLine> getLines() {
        return Collections.unmodifiableList(lines);
    }
}
