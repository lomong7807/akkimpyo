package app.accountbook.ledger;

import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import java.time.Clock;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;

/**
 * 장부에 입력하는 날짜의 범위(P-202). 거래 날짜와 계좌 기준일(P-206)이 같이 쓰고, 거래 목록의 달(#15)도 같은 범위다.
 * 오류 문구에는 입력값을 넣지 않는다.
 */
public final class LedgerDates {

    /** DB의 ck_transaction_occurred_on_min, ck_account_opening_date_min과 같은 값이다. 이보다 앞선 거래는 없다. */
    public static final LocalDate MIN_DATE = LocalDate.of(2000, 1, 1);

    private LedgerDates() {
    }

    /** 주입한 시계의 지금을 장부 시간대의 날짜로 본 값(P-202의 "오늘"). */
    public static LocalDate today(Clock clock, ZoneId ledgerZone) {
        return LocalDate.ofInstant(clock.instant(), ledgerZone);
    }

    /**
     * 2000-01-01부터 오늘로부터 1년 뒤까지(양 끝 포함). "오늘"은 {@link #today}다.
     * 1년 뒤는 달력 기준({@link LocalDate#plusYears})이라 오늘이 2월 29일이면 다음 해 2월 28일이다.
     *
     * 범위 밖이면 그 입력란의 {@link FieldErrorCode#OUT_OF_RANGE}다.
     *
     * @param field   요청 본문의 입력란(예: {@code openingDate})
     * @param subject 오류 문구의 주어. 조사까지 붙인다(예: "날짜는")
     */
    public static void requireInRange(String field, String subject, LocalDate date, Clock clock, ZoneId ledgerZone) {
        if (date.isBefore(MIN_DATE) || date.isAfter(lastDate(clock, ledgerZone))) {
            throw new InvalidRequestException(field, FieldErrorCode.OUT_OF_RANGE,
                    subject + " 2000-01-01부터 오늘로부터 1년 뒤까지 입력할 수 있습니다.");
        }
    }

    /**
     * {@link #requireInRange}의 날이 하루라도 든 달: 2000-01부터 오늘로부터 1년 뒤의 날이 속한 달까지(양 끝 포함, #15).
     * 범위 밖이면 그 입력란의 {@link FieldErrorCode#OUT_OF_RANGE}다.
     *
     * @param field 쿼리 이름(예: {@code month})
     */
    public static void requireMonthInRange(String field, YearMonth month, Clock clock, ZoneId ledgerZone) {
        if (month.isBefore(YearMonth.from(MIN_DATE)) || month.isAfter(YearMonth.from(lastDate(clock, ledgerZone)))) {
            throw new InvalidRequestException(field, FieldErrorCode.OUT_OF_RANGE,
                    "달은 2000-01부터 오늘로부터 1년 뒤의 달까지 볼 수 있습니다.");
        }
    }

    private static LocalDate lastDate(Clock clock, ZoneId ledgerZone) {
        return today(clock, ledgerZone).plusYears(1);
    }
}
