package app.accountbook.transaction;

import java.time.YearMonth;
import java.util.Objects;

/** 거래 목록이 보는 날짜 범위(#15). 순서와 다음 쪽의 규칙은 범위와 무관하게 같다. */
public sealed interface TransactionScope {

    /** 한 달. 그 달의 미래 날짜 거래도 준다. */
    record Month(YearMonth month) implements TransactionScope {

        public Month {
            Objects.requireNonNull(month, "month");
        }
    }

    /** 장부 전체. 장부 시간대의 오늘까지의 거래만 준다(미래 날짜는 빠진다, planner 결정 2026-11-26, #102). */
    record WholeLedger() implements TransactionScope {
    }
}
