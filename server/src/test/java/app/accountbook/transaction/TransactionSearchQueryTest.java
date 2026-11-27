package app.accountbook.transaction;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

import app.accountbook.account.AccountType;
import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.support.StoppedClockConfig;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.transaction.TransactionCommand.Entry;
import app.accountbook.transaction.TransactionPage.Totals;
import app.accountbook.user.User;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

/**
 * 거래 검색(F-223, P-232, #64)의 규칙: 가맹점·메모 부분 일치(대소문자 무시, 특수 글자는 글자 그대로), 금액 일치, 기간,
 * 필터, 합계와 건수, 다음 쪽. 시계는 서울 2026-11-27 12:00이다. 쿼리 값과 cursor는 {@code TransactionSearchTest}가 본다.
 */
@IntegrationTest
@Import(StoppedClockConfig.class)
class TransactionSearchQueryTest {

    private static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    private static final LocalDate NOV_1 = LocalDate.of(2026, 11, 1);
    private static final LocalDate NOV_30 = LocalDate.of(2026, 11, 30);

    @Autowired TransactionListQuery listQuery;
    @Autowired TransactionService transactionService;
    @Autowired StoppedClock clock;
    @Autowired Fixtures fixtures;

    private User owner;
    private UUID ledgerId, cash, bank;
    /** 11-18 지출, 11-19 수입(메모), 11-20 이체, 11-21과 11-22 특수 글자, 11-23 취소, 10-31 지출, 12-05 미래 지출. */
    private UUID noodle, salary, transfer, percent, marks, canceled, october, future;

    @BeforeEach
    void setUp() {
        clock.stopAt(Instant.parse("2026-11-27T03:00:00Z"));
        owner = fixtures.user("search-query@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
        cash = fixtures.account(owner, ledgerId, "현금", AccountType.CASH, 0, LocalDate.of(2026, 1, 1)).getId();
        bank = fixtures.account(owner, ledgerId, "은행", AccountType.BANK, 0, LocalDate.of(2026, 1, 1)).getId();
        noodle = entry(TransactionType.EXPENSE, DAY, 12_000, "올래 Noodle", null);
        salary = entry(TransactionType.INCOME, DAY.plusDays(1), 12_000, null, "12,000원 정산");
        transfer = fixtures.transfer(owner, ledgerId, bank, cash, DAY.plusDays(2), 12_000).id();
        percent = entry(TransactionType.EXPENSE, DAY.plusDays(3), 3_000, "50%할인", null);
        marks = entry(TransactionType.EXPENSE, DAY.plusDays(4), 4_000, "a_b\\c!d", null);
        canceled = fixtures.cancel(owner, transactionService.get(owner.getId(),
                entry(TransactionType.EXPENSE, DAY.plusDays(5), 5_000, "올래 noodle", null))).id();
        fixtures.delete(owner, transactionService.get(owner.getId(),
                entry(TransactionType.EXPENSE, DAY, 12_000, "올래 noodle", "지운 것")));
        october = entry(TransactionType.EXPENSE, LocalDate.of(2026, 10, 31), 12_000, "NOODLE 10월", null);
        future = entry(TransactionType.EXPENSE, LocalDate.of(2026, 12, 5), 1_000, "예약", "noodle 예약");
    }

    @Test
    void 가맹점과_메모를_대소문자_없이_부분_일치로_날짜_역순으로_찾고_삭제는_빠지며_취소는_목록과_건수에만_든다() {
        TransactionPage found = search("NOODLE", null, null, TransactionFilter.NONE);

        assertThat(ids(found)).containsExactly(future, canceled, noodle, october);
        assertThat(found.next()).isNull();
        assertThat(found.totals()).isEqualTo(new Totals(0, 25_000, 4L));
        assertThat(found.days()).isEmpty();
        assertThat(ids(search("12,000원", null, null, TransactionFilter.NONE))).as("메모의 글자와 금액")
                .containsExactly(transfer, salary, noodle, october);
    }

    @Test
    void 퍼센트_밑줄_역슬래시_느낌표는_글자_그대로_찾는다() {
        assertThat(ids(search("%", null, null, TransactionFilter.NONE))).containsExactly(percent);
        assertThat(ids(search("_", null, null, TransactionFilter.NONE))).containsExactly(marks);
        assertThat(ids(search("\\", null, null, TransactionFilter.NONE))).containsExactly(marks);
        assertThat(ids(search("!", null, null, TransactionFilter.NONE))).containsExactly(marks);
        assertThat(ids(search("b\\c!", null, null, TransactionFilter.NONE))).containsExactly(marks);
    }

    @Test
    void 숫자만이면_금액이_같은_지출_수입_이체도_찾고_범위_밖_숫자는_금액으로_보지_않는다() {
        for (String text : List.of("12000", "12,000", "12000원", "12,000 원", "012000")) {
            assertThat(ids(search(text, null, null, TransactionFilter.NONE))).as(text)
                    .containsExactly(transfer, salary, noodle, october);
        }
        assertThat(search("12000", null, null, TransactionFilter.NONE).totals()).as("이체는 건수에만 든다")
                .isEqualTo(new Totals(12_000, 24_000, 4L));
        assertThat(ids(search("99999999999", null, null, TransactionFilter.NONE))).isEmpty();
        assertThat(SearchMatch.amount("9999999999")).contains(9_999_999_999L);
        assertThat(SearchMatch.amount("0")).isEmpty();
        assertThat(SearchMatch.amount("원")).isEmpty();
        assertThat(SearchMatch.amount("12000원원")).isEmpty();
    }

    @Test
    void 기간은_양끝을_넣고_한쪽만_주면_그쪽만_제한하며_필터와_함께_쓴다() {
        TransactionPage november = search("noodle", NOV_1, NOV_30, TransactionFilter.NONE);
        assertThat(ids(november)).containsExactly(canceled, noodle);
        assertThat(november.totals()).isEqualTo(new Totals(0, 12_000, 2L));
        assertThat(ids(search("noodle", DAY, null, TransactionFilter.NONE))).containsExactly(future, canceled, noodle);
        assertThat(ids(search("noodle", null, DAY, TransactionFilter.NONE))).containsExactly(noodle, october);
        assertThat(ids(search(null, DAY, DAY, TransactionFilter.NONE))).containsExactly(noodle);

        TransactionFilter income = new TransactionFilter(Set.of(), Set.of(), Set.of(TransactionType.INCOME), null);
        TransactionPage incomeOnly = search("12000", null, null, income);
        assertThat(ids(incomeOnly)).containsExactly(salary);
        assertThat(incomeOnly.totals()).isEqualTo(new Totals(12_000, 0, 1L));
        TransactionFilter byCash = new TransactionFilter(Set.of(cash), Set.of(), Set.of(), TransactionStatus.CANCELED);
        assertThat(ids(search(null, null, null, byCash))).containsExactly(canceled);
    }

    @Test
    void 조건이_하나도_없으면_q의_REQUIRED이고_시작일이_종료일보다_뒤면_to의_NOT_ALLOWED다() {
        InvalidRequestException none = catchThrowableOfType(InvalidRequestException.class,
                () -> search(null, null, null, TransactionFilter.NONE));
        assertThat(none.field()).isEqualTo("q");
        assertThat(none.code()).isEqualTo(FieldErrorCode.REQUIRED);
        InvalidRequestException reversed = catchThrowableOfType(InvalidRequestException.class,
                () -> search(null, DAY, DAY.minusDays(1), TransactionFilter.NONE));
        assertThat(reversed.field()).isEqualTo("to");
        assertThat(reversed.code()).isEqualTo(FieldErrorCode.NOT_ALLOWED);
    }

    @Test
    void 결과가_51건이면_50건과_다음_쪽이_오고_건수는_전체이며_다음_쪽에는_합계가_없다() {
        for (int i = 0; i < 51; i++) {
            fixtures.expense(owner, ledgerId, cash, null, DAY.minusDays(i % 7), 777);
        }
        TransactionSearch search = new TransactionSearch("777", null, null);

        TransactionPage first = listQuery.search(owner.getId(), ledgerId, search, TransactionFilter.NONE, null);
        TransactionPage second = listQuery.search(owner.getId(), ledgerId, search, TransactionFilter.NONE,
                first.next());

        assertThat(first.items()).hasSize(50);
        assertThat(first.totals()).isEqualTo(new Totals(0, 777 * 51, 51L));
        assertThat(second.items()).hasSize(1);
        assertThat(second.next()).isNull();
        assertThat(second.totals()).isNull();
        assertThat(ids(first)).doesNotContainAnyElementsOf(ids(second));
    }

    private UUID entry(TransactionType type, LocalDate on, long amount, String payee, String memo) {
        return transactionService.create(owner.getId(), ledgerId, new Entry(UUID.randomUUID(), type, on, null, cash,
                null, amount, false, payee, memo, null), "a-phone").id();
    }

    private TransactionPage search(String text, LocalDate from, LocalDate to, TransactionFilter filter) {
        return listQuery.search(owner.getId(), ledgerId, new TransactionSearch(text, from, to), filter, null);
    }

    private static List<UUID> ids(TransactionPage page) {
        return page.items().stream().map(TransactionView::id).toList();
    }
}
