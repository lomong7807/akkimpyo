package app.accountbook.transaction;

import static app.accountbook.transaction.TransactionType.EXPENSE;
import static app.accountbook.transaction.TransactionType.INCOME;
import static app.accountbook.transaction.TransactionType.TRANSFER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;
import static org.assertj.core.api.Assertions.tuple;

import app.accountbook.account.AccountService;
import app.accountbook.account.AccountType;
import app.accountbook.category.CategoryCommand;
import app.accountbook.category.CategoryKind;
import app.accountbook.category.CategoryService;
import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.support.StoppedClockConfig;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.transaction.TransactionPage.DayTotals;
import app.accountbook.transaction.TransactionPage.Totals;
import app.accountbook.transaction.TransactionScope.Month;
import app.accountbook.user.User;
import jakarta.persistence.EntityManager;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

/**
 * 거래 목록의 필터(F-216~F-219, F-303, #62). 쪽, 범위 합계, 날마다 합계가 모두 필터 결과이고(P-205의 취소·이체·휴지통 빼기는
 * 그대로), 다음 쪽이 중복·누락 없이 이어진다. 시계는 서울 2026-11-27 12:00이다. HTTP의 쿼리 값과 cursor는
 * {@code TransactionListTest}가 본다.
 */
@IntegrationTest
@Import(StoppedClockConfig.class)
class TransactionListFilterTest {

    private static final LocalDate DAY = LocalDate.of(2026, 11, 18);

    @Autowired TransactionListQuery listQuery;
    @Autowired TransactionService transactionService;
    @Autowired AccountService accountService;
    @Autowired CategoryService categoryService;
    @Autowired StoppedClock clock;
    @Autowired Fixtures fixtures;
    @Autowired EntityManager entityManager;

    private User owner;
    private UUID ledgerId;
    /** 계좌 현금·은행, 카테고리 식비(지출)와 그 하위 점심, 월급(수입). */
    private UUID cash, bank, food, lunch, salary;
    /**
     * 11-18 현금 점심 1,000원과 은행 식비 2,000원, 11-19 은행 식비 환불 500원, 11-20 은행 월급 100,000원, 11-21 은행에서
     * 현금으로 이체 30,000원, 11-22 현금 점심 4,000원 취소. 그 밖에 휴지통의 11-18 현금 점심과 10월의 현금 점심이 있다.
     */
    private UUID lunchByCash, foodByBank, refund, pay, transfer, canceled;

    @BeforeEach
    void setUp() {
        clock.stopAt(Instant.parse("2026-11-27T03:00:00Z"));
        owner = fixtures.user("list-filter@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
        cash = fixtures.account(owner, ledgerId, "현금", AccountType.CASH, 0, LocalDate.of(2026, 1, 1)).getId();
        bank = fixtures.account(owner, ledgerId, "은행", AccountType.BANK, 0, LocalDate.of(2026, 1, 1)).getId();
        food = category(owner, ledgerId, "식비", CategoryKind.EXPENSE, null);
        lunch = category(owner, ledgerId, "점심", CategoryKind.EXPENSE, food);
        salary = category(owner, ledgerId, "월급", CategoryKind.INCOME, null);
        lunchByCash = fixtures.expense(owner, ledgerId, cash, lunch, DAY, 1_000).id();
        foodByBank = fixtures.expense(owner, ledgerId, bank, food, DAY, 2_000).id();
        refund = fixtures.refund(owner, ledgerId, bank, food, DAY.plusDays(1), 500).id();
        pay = fixtures.income(owner, ledgerId, bank, salary, DAY.plusDays(2), 100_000).id();
        transfer = fixtures.transfer(owner, ledgerId, bank, cash, DAY.plusDays(3), 30_000).id();
        canceled = fixtures.cancel(owner, fixtures.expense(owner, ledgerId, cash, lunch, DAY.plusDays(4), 4_000)).id();
        fixtures.delete(owner, fixtures.expense(owner, ledgerId, cash, lunch, DAY, 8_000));
        fixtures.expense(owner, ledgerId, cash, lunch, LocalDate.of(2026, 10, 31), 16_000);
    }

    @Test
    void 숨긴_계좌도_고를_수_있고_그_계좌의_거래와_그_계좌가_보내거나_받은_이체가_나오며_합계도_그_결과다() {
        accountService.setHidden(owner.getId(), ledgerId, cash, true);
        TransactionPage byCash = page(filter(Set.of(cash), Set.of(), Set.of(), null));

        assertThat(ids(byCash)).containsExactlyInAnyOrder(lunchByCash, transfer, canceled);
        assertThat(byCash.totals()).isEqualTo(new Totals(0, 1_000));
        assertThat(byCash.days()).containsExactly(new DayTotals(DAY.plusDays(4), 0, 0),
                new DayTotals(DAY.plusDays(3), 0, 0), new DayTotals(DAY, 0, 1_000));
        TransactionPage both = page(filter(Set.of(cash, bank), Set.of(), Set.of(), null));
        assertThat(ids(both)).as("두 계좌가 모두 맞는 이체도 한 번").hasSize(6).doesNotHaveDuplicates();
        assertThat(both.totals()).isEqualTo(new Totals(100_000, 2_500));
    }

    /** F-303의 카테고리 거래 목록은 달과 카테고리 필터만으로 된다. 10월과 휴지통의 점심은 빠진다. */
    @Test
    void 카테고리를_고르면_하위도_들고_이체는_빠지며_달과_카테고리만으로_카테고리_거래_목록이_된다() {
        TransactionPage byFood = page(filter(Set.of(), Set.of(food), Set.of(), null));

        assertThat(ids(byFood)).containsExactlyInAnyOrder(lunchByCash, foodByBank, refund, canceled);
        assertThat(byFood.totals()).as("환불은 지출을 줄이고 취소는 빠진다").isEqualTo(new Totals(0, 2_500));
        assertThat(byFood.days()).containsExactly(new DayTotals(DAY.plusDays(4), 0, 0),
                new DayTotals(DAY.plusDays(1), 0, -500), new DayTotals(DAY, 0, 3_000));
        assertThat(ids(page(filter(Set.of(), Set.of(lunch), Set.of(), null))))
                .containsExactlyInAnyOrder(lunchByCash, canceled);
        TransactionPage bySalaryOrLunch = page(filter(Set.of(), Set.of(salary, lunch), Set.of(), null));
        assertThat(ids(bySalaryOrLunch)).containsExactlyInAnyOrder(pay, lunchByCash, canceled);
        assertThat(bySalaryOrLunch.totals()).isEqualTo(new Totals(100_000, 1_000));
    }

    @Test
    void 유형과_상태로_거르면_환불은_지출이고_합계는_취소와_이체를_뺀_그_결과다() {
        assertThat(ids(page(filter(Set.of(), Set.of(), Set.of(EXPENSE), null))))
                .containsExactlyInAnyOrder(lunchByCash, foodByBank, refund, canceled);
        TransactionPage incomeOrTransfer = page(filter(Set.of(), Set.of(), Set.of(INCOME, TRANSFER), null));
        assertThat(ids(incomeOrTransfer)).containsExactlyInAnyOrder(pay, transfer);
        assertThat(incomeOrTransfer.totals()).isEqualTo(new Totals(100_000, 0));
        TransactionPage canceledOnly = page(filter(Set.of(), Set.of(), Set.of(), TransactionStatus.CANCELED));
        assertThat(ids(canceledOnly)).containsExactly(canceled);
        assertThat(canceledOnly.totals()).isEqualTo(new Totals(0, 0));
        assertThat(canceledOnly.days()).containsExactly(new DayTotals(DAY.plusDays(4), 0, 0));
        TransactionPage posted = page(filter(Set.of(), Set.of(), Set.of(), TransactionStatus.POSTED));
        assertThat(ids(posted)).containsExactlyInAnyOrder(lunchByCash, foodByBank, refund, pay, transfer);
        assertThat(posted.totals()).isEqualTo(new Totals(100_000, 2_500));
    }

    @Test
    void 필터끼리는_그리고이고_계좌와_카테고리는_한_라인이_둘_다_맞아야_한다() {
        TransactionPage all = page(filter(Set.of(cash), Set.of(food), Set.of(EXPENSE), TransactionStatus.POSTED));
        assertThat(ids(all)).containsExactly(lunchByCash);
        assertThat(all.totals()).isEqualTo(new Totals(0, 1_000));

        TransactionPage none = page(filter(Set.of(bank), Set.of(lunch), Set.of(), null));
        assertThat(none.items()).isEmpty();
        assertThat(none.totals()).isEqualTo(new Totals(0, 0));
        assertThat(none.days()).isEmpty();
        assertThat(page(filter(Set.of(), Set.of(food), Set.of(TRANSFER), null)).items()).isEmpty();
    }

    /** 첫 쪽과 같은 필터로 다음 키를 따라가면 한 번에 받은 것과 같다. 다음 쪽에는 범위 합계가 없다(#15와 같다). */
    @Test
    void 필터를_켠_채로_다음_쪽을_받아도_중복과_누락이_없다() {
        for (int i = 0; i < 7; i++) {
            transactionService.create(owner.getId(), ledgerId, new TransactionCommand.Entry(UUID.randomUUID(), EXPENSE,
                    DAY.minusDays(i % 3), i % 3 == 0 ? null : LocalTime.of(9, i), i % 2 == 0 ? cash : bank, lunch, 100,
                    null, null, null, null), "test-device");
        }
        TransactionFilter cashFood = filter(Set.of(cash), Set.of(food), Set.of(), null);
        List<UUID> walked = new ArrayList<>();
        TransactionKey after = null;
        do {
            TransactionPage next = page(cashFood, after, 2);
            assertThat(next.totals() == null).isEqualTo(after != null);
            walked.addAll(ids(next));
            after = next.next();
        } while (after != null);

        assertThat(walked).hasSize(6).containsExactlyElementsOf(ids(page(cashFood)));
    }

    /** 다른 장부의 계좌·카테고리(하위가 있는 것)는 없는 id와 같은 오류이고, 둘 다 틀리면 둘 다 알린다. */
    @Test
    void 이_장부에_없는_계좌나_카테고리는_그_입력란의_NOT_FOUND다() {
        User other = fixtures.user("list-filter-other@example.com");
        UUID otherLedger = fixtures.personalLedgerId(other);
        UUID otherCash = fixtures.account(other, otherLedger, "남의현금", AccountType.CASH, 0, DAY).getId();
        UUID otherFood = category(other, otherLedger, "남의식비", CategoryKind.EXPENSE, null);
        category(other, otherLedger, "남의점심", CategoryKind.EXPENSE, otherFood);

        for (TransactionFilter foreign : List.of(filter(Set.of(cash, otherCash), Set.of(food, otherFood), Set.of(), null),
                filter(Set.of(UUID.randomUUID()), Set.of(UUID.randomUUID()), Set.of(), null))) {
            InvalidRequestException rejected = catchThrowableOfType(InvalidRequestException.class, () -> page(foreign));
            assertThat(rejected.errors()).extracting(InvalidRequestException::field, InvalidRequestException::code)
                    .containsExactlyInAnyOrder(tuple("accountId", FieldErrorCode.NOT_FOUND),
                            tuple("categoryId", FieldErrorCode.NOT_FOUND));
        }
    }

    private UUID category(User actor, UUID ledger, String name, CategoryKind kind, UUID parentId) {
        return categoryService.create(actor.getId(), ledger, new CategoryCommand(name, kind, parentId)).getId();
    }

    private static TransactionFilter filter(Set<UUID> accounts, Set<UUID> categories, Set<TransactionType> types,
                                            TransactionStatus status) {
        return new TransactionFilter(accounts, categories, types, status);
    }

    private TransactionPage page(TransactionFilter filter) {
        return page(filter, null, TransactionListQuery.MAX_LIMIT);
    }

    /** 한 트랜잭션 안의 테스트라 만든 거래가 영속성 컨텍스트에 있다. 앱처럼 DB에서 읽게 비운다. */
    private TransactionPage page(TransactionFilter filter, TransactionKey after, int limit) {
        entityManager.flush();
        entityManager.clear();
        return listQuery.page(owner.getId(), ledgerId, new Month(YearMonth.of(2026, 11)), filter, after, limit);
    }

    private static List<UUID> ids(TransactionPage page) {
        return page.items().stream().map(TransactionView::id).toList();
    }
}
