package app.accountbook.ledger;

import app.accountbook.common.InvalidRequestException;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;

/** 장부에 입력하는 날짜의 범위(P-202). 오류 문구에는 입력값을 넣지 않는다. */
public final class LedgerDates {

    private static final LocalDate MIN_DATE = LocalDate.of(2000, 1, 1);

    private LedgerDates() {
    }

    /**
     * 2000-01-01부터 오늘로부터 1년 뒤까지(양 끝 포함). "오늘"은 주입한 시계의 지금을 장부 시간대의 날짜로 본 값이다.
     * 1년 뒤는 달력 기준({@link LocalDate#plusYears})이라 오늘이 2월 29일이면 다음 해 2월 28일이다.
     *
     * @param subject 오류 문구의 주어. 조사까지 붙인다(예: "날짜는")
     */
    public static void requireInRange(String subject, LocalDate date, Clock clock, ZoneId ledgerZone) {
        LocalDate today = LocalDate.ofInstant(clock.instant(), ledgerZone);
        if (date.isBefore(MIN_DATE) || date.isAfter(today.plusYears(1))) {
            throw new InvalidRequestException(subject + " 2000-01-01부터 오늘로부터 1년 뒤까지 입력할 수 있습니다.");
        }
    }
}
