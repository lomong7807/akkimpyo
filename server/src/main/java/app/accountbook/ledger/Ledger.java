package app.accountbook.ledger;

import app.accountbook.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;

@Entity
@Table(name = "ledger")
public class Ledger extends BaseEntity {

    public static final String PERSONAL_LEDGER_NAME = "내 가계부";
    public static final String DEFAULT_TIMEZONE = "Asia/Seoul";

    @Column(name = "name", nullable = false)
    private String name;

    /** 장부 시간대(IANA 이름). 서버가 "오늘"을 정할 때만 쓴다. 거래의 날짜·시각은 이 값으로 변환하지 않는다(P-202). */
    @Column(name = "timezone", nullable = false)
    private String timezone;

    protected Ledger() {
    }

    private Ledger(String name, String timezone) {
        super(UUID.randomUUID());
        this.name = name;
        this.timezone = timezone;
    }

    public static Ledger of(String name, String timezone) {
        return new Ledger(name, timezone);
    }

    /** 가입 시 자동으로 생기는 개인 장부. */
    public static Ledger personal() {
        return of(PERSONAL_LEDGER_NAME, DEFAULT_TIMEZONE);
    }

    public String getName() {
        return name;
    }

    public String getTimezone() {
        return timezone;
    }
}
