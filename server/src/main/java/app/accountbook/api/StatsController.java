package app.accountbook.api;

import app.accountbook.transaction.TransactionListQuery;
import java.time.YearMonth;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 장부의 통계. 구성원 확인은 {@link LedgerMemberInterceptor}가 먼저 하고 조회가 한 번 더 한다. */
@RestController
@RequestMapping(path = "/api/v1/ledgers/{ledgerId}/stats", produces = MediaType.APPLICATION_JSON_VALUE)
class StatsController {

    private final TransactionListQuery transactionListQuery;

    StatsController(TransactionListQuery transactionListQuery) {
        this.transactionListQuery = transactionListQuery;
    }

    /**
     * 달력의 날짜별 합계(F-222, #66 응답 계약). {@code month}의 형식 오류는 거래 목록(#15)과 같게 여기서, 없음과 범위
     * 오류는 조회가 400으로 거절한다. 고른 날의 거래는 거래 목록의 {@code date}로 받는다.
     */
    @GetMapping("/daily")
    DailyTotalsResponse daily(@AuthenticationPrincipal UUID actorId, @PathVariable UUID ledgerId,
                              @RequestParam(name = "month", required = false) String month) {
        YearMonth parsed = month == null ? null
                : TransactionListRequest.month(month).orElseThrow(TransactionListRequest::invalidMonth);
        return DailyTotalsResponse.of(parsed, transactionListQuery.dailyTotals(actorId, ledgerId, parsed));
    }
}
