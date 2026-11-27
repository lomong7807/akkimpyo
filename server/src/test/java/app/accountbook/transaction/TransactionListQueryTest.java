package app.accountbook.transaction;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatNoException;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

import app.accountbook.account.AccountType;
import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.ledger.LedgerDates;
import app.accountbook.ledger.LedgerRole;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.support.StoppedClockConfig;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.transaction.TransactionCommand.Entry;
import app.accountbook.transaction.TransactionScope.Day;
import app.accountbook.transaction.TransactionScope.Month;
import app.accountbook.transaction.TransactionScope.WholeLedger;
import app.accountbook.user.User;
import jakarta.persistence.EntityManager;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.function.Predicate;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

/**
 * 거래 목록의 순서, 다음 쪽, 범위(#15 응답 계약). 시계는 UTC 2026-11-27 03:00(서울 11-27 12:00)에 멈춰 있고,
 * 날짜 경계를 보는 테스트만 옮긴다. 장부는 가입이 만든 개인 장부(Asia/Seoul)다.
 */
@IntegrationTest
@Import(StoppedClockConfig.class)
class TransactionListQueryTest {

    private static final Instant NOW = Instant.parse("2026-11-27T03:00:00Z");
    private static final Month NOVEMBER = new Month(YearMonth.of(2026, 11));
    private static final String DEVICE = "test-device";
    /** DB가 거래를 내놓는 순서(#15). uuid는 바이트 순서라 소문자 글자 순서와 같다. */
    private static final Comparator<TransactionKey> LIST_ORDER = Comparator.comparing(TransactionKey::occurredOn)
            .thenComparing(TransactionKey::occurredTime, Comparator.nullsFirst(Comparator.naturalOrder()))
            .thenComparing(key -> key.id().toString())
            .reversed();

    @Autowired TransactionListQuery listQuery;
    @Autowired TransactionService transactionService;
    @Autowired StoppedClock clock;
    @Autowired Fixtures fixtures;
    @Autowired EntityManager entityManager;

    private User owner;
    private UUID ledgerId;
    private UUID cash;
    private final List<TransactionKey> made = new ArrayList<>();

    @BeforeEach
    void setUp() {
        clock.stopAt(NOW);
        owner = fixtures.user("list-owner@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
        cash = fixtures.account(owner, ledgerId, "현금", AccountType.CASH, 0, LocalDate.of(2024, 1, 1)).getId();
    }

    @Test
    void 날짜_역순이고_같은_날은_시각_있는_것이_시각_역순으로_먼저_시각_없는_것이_아래_같으면_id_역순이다() {
        LocalDate day = LocalDate.of(2026, 11, 18);
        for (String time : new String[] {"09:00", "18:30", null, "09:00", null, "00:00", "23:59:59.999"}) {
            expense(day, time);
        }
        expense(LocalDate.of(2026, 11, 20), null);
        expense(LocalDate.of(2026, 11, 1), "12:00");
        expense(LocalDate.of(2026, 11, 30), "07:00");
        UUID october = expense(LocalDate.of(2026, 10, 31), "23:00");
        UUID december = expense(LocalDate.of(2026, 12, 1), null);

        TransactionPage page = page(NOVEMBER, null, 50);

        assertThat(ids(page)).containsExactlyElementsOf(expected(NOVEMBER)).doesNotContain(october, december);
        assertThat(page.next()).isNull();
        assertThat(page.items().getFirst()).isEqualTo(transactionService.get(owner.getId(), page.items().getFirst().id()));
    }

    @Test
    void 휴지통의_거래는_빠지고_취소한_거래는_들어오며_고친_사람은_마지막으로_고친_구성원이다() {
        User member = fixtures.user("list-member@example.com");
        fixtures.addMember(ledgerId, member, LedgerRole.MEMBER);
        UUID kept = expense(LocalDate.of(2026, 11, 19), null);
        TransactionView canceled = fixtures.cancel(member, view(expense(LocalDate.of(2026, 11, 20), null)));
        fixtures.delete(owner, view(expense(LocalDate.of(2026, 11, 21), null)));
        UUID bank = fixtures.account(owner, ledgerId, "은행", AccountType.BANK, 0, LocalDate.of(2024, 1, 1)).getId();
        TransactionView transfer = fixtures.transfer(owner, ledgerId, bank, cash, LocalDate.of(2026, 11, 2), 5_000);

        TransactionPage page = page(NOVEMBER, null, 50);

        assertThat(ids(page)).containsExactly(canceled.id(), kept, transfer.id());
        TransactionView listed = page.items().getFirst();
        assertThat(listed.status()).isEqualTo(TransactionStatus.CANCELED);
        assertThat(listed.updatedBy()).isEqualTo(member.getId());
        assertThat(listed.createdBy()).isEqualTo(owner.getId());
        assertThat(page.items().getLast().lines()).containsExactlyInAnyOrderElementsOf(transfer.lines());
    }

    @Test
    void 달의_1일과_말일_거래는_그_달에만_나온다_윤년과_평년의_2월() {
        UUID jan31 = expense(LocalDate.of(2024, 1, 31), "23:59");
        UUID leapFeb1 = expense(LocalDate.of(2024, 2, 1), "00:00");
        UUID leapFeb29 = expense(LocalDate.of(2024, 2, 29), "23:59");
        UUID leapMar1 = expense(LocalDate.of(2024, 3, 1), null);
        UUID feb28 = expense(LocalDate.of(2025, 2, 28), null);
        UUID mar1 = expense(LocalDate.of(2025, 3, 1), "00:00");

        assertThat(ids(page(month(2024, 1), null, 50))).containsExactly(jan31);
        assertThat(ids(page(month(2024, 2), null, 50))).containsExactly(leapFeb29, leapFeb1);
        assertThat(ids(page(month(2024, 3), null, 50))).containsExactly(leapMar1);
        assertThat(ids(page(month(2025, 2), null, 50))).containsExactly(feb28);
        assertThat(ids(page(month(2025, 3), null, 50))).containsExactly(mar1);
    }

    @Test
    void 거래가_51건이면_첫_쪽에_50건과_다음_키가_오고_다음_쪽에_1건이_온다() {
        for (int i = 0; i < 51; i++) {
            expense(LocalDate.of(2026, 11, 1 + i % 28), i % 3 == 0 ? null : "%02d:00".formatted(i % 24));
        }

        TransactionPage first = page(NOVEMBER, null, TransactionListQuery.MAX_LIMIT);
        TransactionPage second = page(NOVEMBER, first.next(), TransactionListQuery.MAX_LIMIT);

        assertThat(first.items()).hasSize(50);
        assertThat(first.next()).isEqualTo(TransactionKey.of(first.items().getLast()));
        assertThat(second.items()).hasSize(1);
        assertThat(second.next()).isNull();
        List<UUID> all = new ArrayList<>(ids(first));
        all.addAll(ids(second));
        assertThat(all).containsExactlyElementsOf(expected(NOVEMBER));
    }

    /** 쪽의 끝이 시각 있는 것과 없는 것 사이, 시각 없는 것끼리, 같은 시각끼리, 날짜 사이에 모두 걸린다. */
    @Test
    void 쪽의_경계가_어디에_걸려도_빠지거나_겹치는_거래가_없다() {
        LocalDate day = LocalDate.of(2026, 11, 18);
        for (String time : new String[] {"10:00", "10:00", "10:00", null, null, null, "08:00", null}) {
            expense(day, time);
        }
        expense(day.minusDays(1), null);
        expense(day.minusDays(1), "10:00");

        for (int limit = 1; limit <= 4; limit++) {
            assertThat(walk(NOVEMBER, limit)).as("limit " + limit).containsExactlyElementsOf(expected(NOVEMBER));
        }
    }

    @Test
    void 쪽_사이에_거래를_더하거나_지워도_받은_거래가_다시_오거나_남은_거래가_빠지지_않는다() {
        LocalDate day = LocalDate.of(2026, 11, 18);
        for (String time : new String[] {"21:00", "20:00", "19:00", null, null, null}) {
            expense(day, time);
        }
        List<UUID> order = expected(NOVEMBER);
        TransactionPage first = page(NOVEMBER, null, 3);
        assertThat(ids(first)).containsExactlyElementsOf(order.subList(0, 3));

        expense(day, "22:00");                       // 이미 지난 자리: 오지 않는다
        UUID behind = expense(day.minusDays(1), null); // 아직 오지 않은 자리: 온다
        fixtures.delete(owner, view(order.get(2)));  // 앞 쪽의 마지막 거래(키의 주인)
        fixtures.delete(owner, view(order.get(4)));  // 아직 받지 않은 거래

        TransactionPage rest = page(NOVEMBER, first.next(), 50);

        assertThat(ids(rest)).containsExactly(order.get(3), order.get(5), behind);
    }

    @Test
    void 장부_전체는_장부_시간대의_오늘까지만_주고_달은_그_달의_미래도_준다() {
        clock.stopAt(Instant.parse("2026-11-27T14:59:59Z")); // 서울 11-27 23:59:59
        UUID today = expense(LocalDate.of(2026, 11, 27), "23:59");
        UUID tomorrow = expense(LocalDate.of(2026, 11, 28), "00:00");
        UUID older = expense(LocalDate.of(2025, 1, 1), null);

        assertThat(ids(page(new WholeLedger(), null, 50))).containsExactly(today, older);
        assertThat(ids(page(NOVEMBER, null, 50))).containsExactly(tomorrow, today);

        clock.stopAt(Instant.parse("2026-11-27T15:00:00Z")); // 서울 11-28 00:00
        assertThat(ids(page(new WholeLedger(), null, 50))).containsExactly(tomorrow, today, older);
        assertThat(walk(new WholeLedger(), 1)).containsExactly(tomorrow, today, older);
    }

    @Test
    void 하루는_그날의_거래만_같은_순서와_다음_키_규칙으로_주고_날짜는_장부_시간대로_1년_뒤까지다() {
        LocalDate day = LocalDate.of(2026, 11, 30); // 미래 날짜도 된다
        for (String time : new String[] {"10:00", null, "09:00", null, "10:00"}) {
            expense(day, time);
        }
        expense(day.minusDays(1), "23:59");
        expense(day.plusDays(1), "00:00");

        for (int limit = 1; limit <= 3; limit++) {
            assertThat(walk(new Day(day), limit)).as("limit " + limit).containsExactlyElementsOf(expected(day::equals));
        }
        assertOutOfRange("date", () -> listQuery.page(owner.getId(), ledgerId, new Day(LocalDate.of(1999, 12, 31)),
                null, 1));
        // 서울 11-27의 1년 뒤는 2027-11-27이다.
        assertOutOfRange("date", () -> listQuery.page(owner.getId(), ledgerId, new Day(LocalDate.of(2027, 11, 28)),
                null, 1));
        assertThatNoException().isThrownBy(() -> page(new Day(LocalDate.of(2027, 11, 27)), null, 1));
        assertThatNoException().isThrownBy(() -> page(new Day(LedgerDates.MIN_DATE), null, 1));
    }

    @Test
    void limit은_1부터_50까지이고_달은_2000_01부터_장부_시간대로_1년_뒤의_날이_속한_달까지다() {
        clock.stopAt(Instant.parse("2026-11-30T14:59:59Z")); // 서울 11-30, 1년 뒤는 2027-11-30

        assertOutOfRange("limit", () -> listQuery.page(owner.getId(), ledgerId, NOVEMBER, null, 0));
        assertOutOfRange("limit", () -> listQuery.page(owner.getId(), ledgerId, NOVEMBER, null, 51));
        assertOutOfRange("month", () -> listQuery.page(owner.getId(), ledgerId, month(1999, 12), null, 1));
        assertOutOfRange("month", () -> listQuery.page(owner.getId(), ledgerId, month(2027, 12), null, 1));
        assertThatNoException().isThrownBy(() -> page(month(2000, 1), null, 1));
        assertThatNoException().isThrownBy(() -> page(month(2027, 11), null, 50));

        clock.stopAt(Instant.parse("2026-11-30T15:00:00Z")); // 서울 12-01, 1년 뒤는 2027-12-01
        assertThatNoException().isThrownBy(() -> page(month(2027, 12), null, 1));
    }

    /** 지출 1,000원. 시각은 {@code HH:mm[:ss[.SSS]]}이고 null이면 시각 없음이다. */
    private UUID expense(LocalDate on, String time) {
        UUID id = UUID.randomUUID();
        LocalTime at = time == null ? null : LocalTime.parse(time);
        transactionService.create(owner.getId(), ledgerId, new Entry(id, TransactionType.EXPENSE, on, at, cash, null,
                1_000, false, null, null, null), DEVICE);
        made.add(new TransactionKey(on, at, id));
        return id;
    }

    /** 만든 거래 가운데 그 달의 것을 목록 순서로. 지운 거래는 부르는 쪽이 뺀다. */
    private List<UUID> expected(Month month) {
        return expected(date -> YearMonth.from(date).equals(month.month()));
    }

    private List<UUID> expected(Predicate<LocalDate> inScope) {
        return made.stream()
                .filter(key -> inScope.test(key.occurredOn()))
                .sorted(LIST_ORDER)
                .map(TransactionKey::id)
                .toList();
    }

    /** 한 트랜잭션 안의 테스트라 만든 거래가 영속성 컨텍스트에 있다. 앱처럼 DB에서 읽게 비운다. */
    private TransactionPage page(TransactionScope scope, TransactionKey after, int limit) {
        entityManager.flush();
        entityManager.clear();
        return listQuery.page(owner.getId(), ledgerId, scope, after, limit);
    }

    /** 첫 쪽부터 다음 키를 따라 끝까지 받은 거래 id. */
    private List<UUID> walk(TransactionScope scope, int limit) {
        List<UUID> ids = new ArrayList<>();
        TransactionKey after = null;
        for (int pages = 0; pages < 100; pages++) {
            TransactionPage page = page(scope, after, limit);
            ids.addAll(ids(page));
            after = page.next();
            if (after == null) {
                return ids;
            }
        }
        throw new AssertionError("다음 키가 끝나지 않는다");
    }

    private TransactionView view(UUID id) {
        return transactionService.get(owner.getId(), id);
    }

    private static List<UUID> ids(TransactionPage page) {
        return page.items().stream().map(TransactionView::id).toList();
    }

    private static Month month(int year, int month) {
        return new Month(YearMonth.of(year, month));
    }

    private static void assertOutOfRange(String field, ThrowingCallable call) {
        InvalidRequestException rejected = catchThrowableOfType(InvalidRequestException.class, call);
        assertThat(rejected).as(field).isNotNull();
        assertThat(rejected.field()).isEqualTo(field);
        assertThat(rejected.code()).isEqualTo(FieldErrorCode.OUT_OF_RANGE);
    }
}
