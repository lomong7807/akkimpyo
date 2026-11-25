package app.accountbook.transaction;

import app.accountbook.common.InvalidRequestException;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;

/** 거래 입력값의 범위: 금액(P-201)과 날짜(P-202). 오류 문구에는 입력값을 넣지 않는다. */
final class TransactionLimits {

    static final long MIN_AMOUNT = 1L;
    static final long MAX_AMOUNT = 9_999_999_999L;
    static final LocalDate MIN_DATE = LocalDate.of(2000, 1, 1);

    private TransactionLimits() {
    }

    /** 입력 금액은 부호 없는 크기다. 라인의 부호는 서비스가 거래 종류로 정한다. */
    static void requireAmountInRange(long amount) {
        if (amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
            throw new InvalidRequestException("금액은 1원부터 9,999,999,999원까지 입력할 수 있습니다.");
        }
    }

    /**
     * 2000-01-01부터 오늘로부터 1년 뒤까지(양 끝 포함). "오늘"은 주입한 시계의 지금을 장부 시간대의 날짜로 본 값이다.
     * 1년 뒤는 달력 기준({@link LocalDate#plusYears})이라 오늘이 2월 29일이면 다음 해 2월 28일이다.
     */
    static void requireDateInRange(LocalDate occurredOn, Clock clock, ZoneId ledgerZone) {
        LocalDate today = LocalDate.ofInstant(clock.instant(), ledgerZone);
        if (occurredOn.isBefore(MIN_DATE) || occurredOn.isAfter(today.plusYears(1))) {
            throw new InvalidRequestException("날짜는 2000-01-01부터 오늘로부터 1년 뒤까지 입력할 수 있습니다.");
        }
    }
}
