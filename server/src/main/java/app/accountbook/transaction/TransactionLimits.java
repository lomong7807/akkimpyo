package app.accountbook.transaction;

import app.accountbook.common.InvalidRequestException;
import app.accountbook.ledger.LedgerDates;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;

/** 거래 입력값의 범위: 금액(P-201)과 날짜(P-202). 오류 문구에는 입력값을 넣지 않는다. */
final class TransactionLimits {

    static final long MIN_AMOUNT = 1L;
    static final long MAX_AMOUNT = 9_999_999_999L;

    private TransactionLimits() {
    }

    /** 입력 금액은 부호 없는 크기다. 라인의 부호는 서비스가 거래 종류로 정한다. */
    static void requireAmountInRange(long amount) {
        if (amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
            throw new InvalidRequestException("금액은 1원부터 9,999,999,999원까지 입력할 수 있습니다.");
        }
    }

    /** 범위는 {@link LedgerDates}가 정한다. */
    static void requireDateInRange(LocalDate occurredOn, Clock clock, ZoneId ledgerZone) {
        LedgerDates.requireInRange("날짜는", occurredOn, clock, ledgerZone);
    }
}
