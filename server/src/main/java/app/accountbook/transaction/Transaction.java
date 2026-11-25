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
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

/**
 * 거래 헤더. 돈의 움직임은 분개 라인(lines)으로 저장한다.
 * version은 JPA @Version을 쓰지 않는다. 서비스가 조건부 UPDATE로 직접 비교·증가한다.
 *
 * <p>날짜와 시각(P-202): 사용자가 입력한 날짜와 시각을 그대로 저장한다. 시간대 변환을 하지 않는다.
 * 장부 시간대는 서버가 "오늘"을 정할 때만 쓰고, 저장된 날짜와 시각을 해석하거나 바꾸는 데는 쓰지 않는다.
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

    /** 입력한 날짜 그대로다(시간대 변환 없음). 집계 기준이다. */
    @Column(name = "occurred_on", nullable = false)
    private LocalDate occurredOn;

    /** 입력한 시각 그대로다(시간대 변환 없음). 입력하지 않았으면 null(시각 없음)이다. */
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
        this.occurredTime = storableTime(occurredTime);
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

    /**
     * 저장소가 실제로 보존하는 정밀도(밀리초)로 자른 시각. Hibernate는 LocalTime을 java.sql.Time으로 넘겨
     * 밀리초 아래를 버린다. 메모리 값과 저장 값이 달라 재전송 비교가 어긋나지 않도록 미리 같은 값으로 맞춘다.
     */
    public static LocalTime storableTime(LocalTime time) {
        return time == null ? null : time.truncatedTo(ChronoUnit.MILLIS);
    }

    public Transaction addLine(UUID accountId, UUID categoryId, long amount) {
        lines.add(TransactionLine.of(this, accountId, categoryId, amount));
        return this;
    }

    /** 라인을 모두 지운다(orphanRemoval). 수정은 라인을 통째로 교체한다. */
    public void clearLines() {
        lines.clear();
    }

    public void changeDetails(LocalDate occurredOn, LocalTime occurredTime, String payee, String memo,
                              UUID paidBy) {
        this.occurredOn = occurredOn;
        this.occurredTime = storableTime(occurredTime);
        this.payee = payee;
        this.memo = memo;
        this.paidBy = paidBy;
    }

    public void cancel() {
        this.status = TransactionStatus.CANCELED;
    }

    /** 소프트 삭제. 라인은 그대로 남는다. */
    public void markDeleted(Instant at) {
        this.deletedAt = at;
    }

    public void restore() {
        this.deletedAt = null;
    }

    /**
     * 조건부 UPDATE로 DB의 version을 올린 뒤 메모리 값을 맞춘다.
     * 맞추지 않으면 flush 때 옛 version이 다시 기록된다.
     */
    void applyVersion(long version, Instant updatedAt) {
        this.version = version;
        this.updatedAt = updatedAt;
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
