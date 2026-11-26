package app.accountbook.account;

import app.accountbook.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "account")
public class Account extends BaseEntity {

    public static final String DEFAULT_CURRENCY = "KRW";

    @Column(name = "ledger_id", nullable = false, updatable = false)
    private UUID ledgerId;

    @Column(name = "name", nullable = false)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(name = "type", nullable = false)
    private AccountType type;

    /** 기준일 시점의 잔액(정수 원). 카드 부채는 음수일 수 있다. */
    @Column(name = "opening_balance", nullable = false)
    private long openingBalance;

    /** 이 날짜(포함) 이후 거래만 잔액에 반영된다. */
    @Column(name = "opening_date", nullable = false)
    private LocalDate openingDate;

    @JdbcTypeCode(SqlTypes.CHAR)
    @Column(name = "currency", nullable = false, length = 3)
    private String currency;

    protected Account() {
    }

    private Account(UUID ledgerId, String name, AccountType type, long openingBalance, LocalDate openingDate) {
        super(UUID.randomUUID());
        this.ledgerId = ledgerId;
        this.name = name;
        this.type = type;
        this.openingBalance = openingBalance;
        this.openingDate = openingDate;
        this.currency = DEFAULT_CURRENCY;
    }

    public static Account of(UUID ledgerId, String name, AccountType type, long openingBalance,
                             LocalDate openingDate) {
        return new Account(ledgerId, name, type, openingBalance, openingDate);
    }

    public void update(String name, AccountType type, long openingBalance, LocalDate openingDate) {
        this.name = name;
        this.type = type;
        this.openingBalance = openingBalance;
        this.openingDate = openingDate;
    }

    public UUID getLedgerId() {
        return ledgerId;
    }

    public String getName() {
        return name;
    }

    public AccountType getType() {
        return type;
    }

    public long getOpeningBalance() {
        return openingBalance;
    }

    public LocalDate getOpeningDate() {
        return openingDate;
    }

    public String getCurrency() {
        return currency;
    }
}
