package app.accountbook.transaction;

import app.accountbook.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.util.UUID;

/**
 * 분개 라인. amount는 계좌 잔액을 늘리면 양수, 줄이면 음수다. 이체 라인은 category가 없다.
 * ledgerId는 언제나 거래의 장부다. DB의 복합 FK(V12)가 거래·계좌·카테고리와 같은 장부인지 확인한다.
 */
@Entity
@Table(name = "transaction_line")
public class TransactionLine extends BaseEntity {

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "transaction_id", nullable = false, updatable = false)
    private Transaction transaction;

    @Column(name = "ledger_id", nullable = false, updatable = false)
    private UUID ledgerId;

    @Column(name = "account_id", nullable = false, updatable = false)
    private UUID accountId;

    @Column(name = "category_id", updatable = false)
    private UUID categoryId;

    @Column(name = "amount", nullable = false, updatable = false)
    private long amount;

    protected TransactionLine() {
    }

    private TransactionLine(Transaction transaction, UUID accountId, UUID categoryId, long amount) {
        super(UUID.randomUUID());
        this.transaction = transaction;
        this.ledgerId = transaction.getLedgerId();
        this.accountId = accountId;
        this.categoryId = categoryId;
        this.amount = amount;
    }

    static TransactionLine of(Transaction transaction, UUID accountId, UUID categoryId, long amount) {
        return new TransactionLine(transaction, accountId, categoryId, amount);
    }

    public Transaction getTransaction() {
        return transaction;
    }

    public UUID getAccountId() {
        return accountId;
    }

    public UUID getCategoryId() {
        return categoryId;
    }

    public long getAmount() {
        return amount;
    }
}
