package app.accountbook.api;

import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.stats.MonthlyStatsQuery;
import app.accountbook.stats.YearlyStatsQuery;
import app.accountbook.transaction.TransactionListQuery;
import java.time.Year;
import java.time.YearMonth;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 장부의 통계. 구성원 확인은 {@link LedgerMemberInterceptor}가 먼저 하고 조회가 한 번 더 한다. {@code month}와
 * {@code year}의 형식 오류는 거래 목록(#15)과 같게 여기서, 없음과 범위 오류는 조회가 400으로 거절한다.
 */
@RestController
@RequestMapping(path = "/api/v1/ledgers/{ledgerId}/stats", produces = MediaType.APPLICATION_JSON_VALUE)
class StatsController {

    private static final Pattern YEAR = Pattern.compile("[0-9]{4}");

    private final TransactionListQuery transactionListQuery;
    private final MonthlyStatsQuery monthlyStatsQuery;
    private final YearlyStatsQuery yearlyStatsQuery;

    StatsController(TransactionListQuery transactionListQuery, MonthlyStatsQuery monthlyStatsQuery,
                    YearlyStatsQuery yearlyStatsQuery) {
        this.transactionListQuery = transactionListQuery;
        this.monthlyStatsQuery = monthlyStatsQuery;
        this.yearlyStatsQuery = yearlyStatsQuery;
    }

    /** 달력의 날짜별 합계(F-222, #66 응답 계약). 고른 날의 거래는 거래 목록의 {@code date}로 받는다. */
    @GetMapping("/daily")
    DailyTotalsResponse getDailyStats(@AuthenticationPrincipal UUID actorId, @PathVariable UUID ledgerId,
                              @RequestParam(name = "month", required = false) String month) {
        YearMonth parsed = month(month);
        return DailyTotalsResponse.of(parsed, transactionListQuery.dailyTotals(actorId, ledgerId, parsed));
    }

    /** 월별 통계(F-301, #16 응답 계약). */
    @GetMapping("/monthly")
    MonthlyStatsResponse getMonthlyStats(@AuthenticationPrincipal UUID actorId, @PathVariable UUID ledgerId,
                                 @RequestParam(name = "month", required = false) String month) {
        YearMonth parsed = month(month);
        return MonthlyStatsResponse.of(parsed, monthlyStatsQuery.monthly(actorId, ledgerId, parsed));
    }

    /** 달의 카테고리별 통계(F-302, #48 응답 계약). 계산은 월별 통계와 같은 조회다. */
    @GetMapping("/categories")
    CategoryStatsResponse getCategoryStats(@AuthenticationPrincipal UUID actorId, @PathVariable UUID ledgerId,
                                     @RequestParam(name = "month", required = false) String month) {
        YearMonth parsed = month(month);
        return CategoryStatsResponse.of(parsed, monthlyStatsQuery.monthly(actorId, ledgerId, parsed));
    }

    /** 연 단위 통계(F-304, #48 응답 계약). */
    @GetMapping("/yearly")
    YearlyStatsResponse getYearlyStats(@AuthenticationPrincipal UUID actorId, @PathVariable UUID ledgerId,
                               @RequestParam(name = "year", required = false) String year) {
        return YearlyStatsResponse.of(yearlyStatsQuery.yearly(actorId, ledgerId, year(year)));
    }

    /** 없으면 null(조회가 {@code REQUIRED}로 거절한다). */
    private static YearMonth month(String month) {
        return month == null ? null
                : TransactionListRequest.month(month).orElseThrow(TransactionListRequest::invalidMonth);
    }

    /** {@code YYYY}. 없으면 null(조회가 {@code REQUIRED}로 거절한다). 범위는 조회가 본다. */
    private static Year year(String year) {
        return year == null ? null : TransactionListRequest.parsed(YEAR, year, Year::parse)
                .orElseThrow(() -> new InvalidRequestException("year", FieldErrorCode.INVALID_FORMAT,
                        "year는 YYYY입니다."));
    }
}
