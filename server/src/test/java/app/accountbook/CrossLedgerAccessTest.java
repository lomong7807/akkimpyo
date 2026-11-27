package app.accountbook;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.assertj.core.api.Assertions.catchThrowableOfType;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

import app.accountbook.account.Account;
import app.accountbook.account.AccountCommand;
import app.accountbook.account.AccountService;
import app.accountbook.account.AccountType;
import app.accountbook.category.Category;
import app.accountbook.category.CategoryCommand;
import app.accountbook.category.CategoryKind;
import app.accountbook.category.CategoryService;
import app.accountbook.common.AccountHasTransactionsException;
import app.accountbook.common.InUseException;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.InvalidStateException;
import app.accountbook.common.NotFoundException;
import app.accountbook.common.NotLedgerMemberException;
import app.accountbook.common.NotLedgerOwnerException;
import app.accountbook.ledger.LedgerAccess;
import app.accountbook.ledger.LedgerMembership;
import app.accountbook.ledger.LedgerService;
import app.accountbook.stats.BalanceQuery;
import app.accountbook.stats.MonthlyStatsQuery;
import app.accountbook.stats.MonthlySummary;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.transaction.CategorySuggestionQuery;
import app.accountbook.transaction.IdConflictException;
import app.accountbook.transaction.StaleVersionException;
import app.accountbook.transaction.TransactionCommand;
import app.accountbook.transaction.TransactionCommand.Entry;
import app.accountbook.transaction.TransactionCommand.Transfer;
import app.accountbook.transaction.TransactionExportQuery;
import app.accountbook.transaction.TransactionListQuery;
import app.accountbook.transaction.TransactionPage.DayTotals;
import app.accountbook.transaction.TransactionScope.Day;
import app.accountbook.transaction.TransactionScope.Month;
import app.accountbook.transaction.TransactionScope.WholeLedger;
import app.accountbook.transaction.TransactionService;
import app.accountbook.transaction.TransactionType;
import app.accountbook.transaction.TransactionView;
import app.accountbook.user.User;
import app.accountbook.user.UserProfile;
import app.accountbook.user.UserService;
import jakarta.persistence.EntityManager;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.function.Supplier;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.aopalliance.intercept.MethodInterceptor;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.aop.support.AopUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 이슈 #19(서비스 계층): 사용자 A가 B의 장부에 닿을 수 없음을 표로 고정한다.
 *
 * <p>표의 한 줄({@link Row})마다 네 가지를 확인한다.
 * <ol>
 *   <li>A가 B의 대상으로 요청하면 정해진 예외로 거부되고, 메시지에 B의 값이 없다.</li>
 *   <li>같은 요청을 실제로 없는 id로 하면 예외의 종류와 메시지가 같다(P-903).</li>
 *   <li>거부한 뒤 DB의 모든 테이블이 그대로다(행 수, 값, version, 변경 이력).</li>
 *   <li>대조: 권한이 있는 쪽이 같은 요청을 하면 통과한다(또는 권한이 있어야만 보이는 다른 오류가 난다).
 *       요청 자체가 틀려서 거부된 것이 아님을 보인다. 대조 요청은 SAVEPOINT로 되돌린다.</li>
 * </ol>
 *
 * <p>준비 데이터는 한 번만 만들고, 표 전체가 테스트 트랜잭션 하나 안에서 돈다. 그래서 어느 줄이 실제로 뚫려
 * DB가 바뀌면 뒤의 줄들도 "DB가 달라졌다"로 함께 실패한다. 원인은 처음 실패한 줄이다.
 *
 * <p>표의 마지막 줄은 서비스와 조회 클래스의 공개 메서드 가운데 호출자(actorId)를 받는 것이 모두 이 표에서
 * A의 요청으로 불렸는지 확인한다({@link ServiceMethodInventoryTest}). 새 공개 메서드를 더하면 이 표에 줄을
 * 더해야 통과한다. 불렸는지는 손으로 적지 않고, 서비스를 감싼 프록시가 실제 호출을 기록한다.
 */
@IntegrationTest
class CrossLedgerAccessTest {

    static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    static final LocalDate OPENING = LocalDate.of(2026, 11, 1);
    static final YearMonth NOVEMBER = YearMonth.of(2026, 11);
    static final String DEVICE = "a-phone";
    static final String MALFORMED_DEVICE = "a phone";

    @Autowired AccountService accountService;
    @Autowired CategoryService categoryService;
    @Autowired TransactionService transactionService;
    @Autowired TransactionListQuery transactionListQuery;
    @Autowired CategorySuggestionQuery categorySuggestionQuery;
    @Autowired TransactionExportQuery transactionExportQuery;
    @Autowired BalanceQuery balanceQuery;
    @Autowired MonthlyStatsQuery monthlyStatsQuery;
    @Autowired LedgerAccess ledgerAccess;
    @Autowired LedgerService ledgerService;
    @Autowired UserService userService;
    @Autowired Fixtures fixtures;
    @Autowired EntityManager entityManager;
    @Autowired JdbcTemplate jdbc;

    UUID a;
    UUID ledgerA;
    UUID aBank;
    UUID aCash;
    UUID aFood;
    TransactionView aExpense;
    TransactionView aTransfer;
    TransactionView aDeleted;

    UUID b;
    UUID ledgerB;
    UUID bBank;          // 거래가 있는 계좌
    UUID bCash;
    UUID bEmptyAccount;  // 거래가 없어 B는 지울 수 있는 계좌
    UUID bFood;          // 하위 분류와 거래가 있는 지출 분류
    UUID bLunch;         // bFood의 하위 분류
    UUID bSpare;         // 거래가 없어 B는 지울 수 있는 분류
    UUID bUncategorized; // 기본 카테고리(미분류)
    TransactionView bExpense;
    TransactionView bTransfer;
    TransactionView bDeleted;
    TransactionView bCanceled;

    /** 실제로 없는 id. 장부, 계좌, 카테고리, 거래, 사용자 어느 자리에 넣어도 없다. */
    final UUID missing = UUID.randomUUID();

    /** 거부 메시지에 나오면 안 되는 B의 값. */
    List<String> secretsOfB;
    Map<String, List<Map<String, Object>>> baseline;

    /** 표의 거부 단계(A가 B의 대상으로 요청)에서 실제로 불린 "클래스.메서드". */
    final Set<String> calledByA = new HashSet<>();
    boolean recording;

    @BeforeEach
    void setUp() {
        User userA = fixtures.user("a@example.com");
        a = userA.getId();
        ledgerA = fixtures.personalLedgerId(userA);
        aBank = fixtures.account(userA, ledgerA, "A은행", AccountType.BANK, 100_000, OPENING).getId();
        aCash = fixtures.account(userA, ledgerA, "A현금", AccountType.CASH, 0, OPENING).getId();
        aFood = category(a, ledgerA, "A식비", CategoryKind.EXPENSE, null);
        aExpense = fixtures.expense(userA, ledgerA, aBank, aFood, DAY, 1_100);
        aTransfer = fixtures.transfer(userA, ledgerA, aBank, aCash, DAY, 2_200);
        aDeleted = fixtures.delete(userA, fixtures.expense(userA, ledgerA, aBank, aFood, DAY, 3_300));

        User userB = fixtures.user("b@example.com");
        b = userB.getId();
        ledgerB = fixtures.personalLedgerId(userB);
        bBank = fixtures.account(userB, ledgerB, "B월급통장", AccountType.BANK, 5_432_100, OPENING).getId();
        bCash = fixtures.account(userB, ledgerB, "B비상금", AccountType.CASH, 0, OPENING).getId();
        bEmptyAccount = fixtures.account(userB, ledgerB, "B빈계좌", AccountType.CASH, 0, OPENING).getId();
        bFood = category(b, ledgerB, "B식비", CategoryKind.EXPENSE, null);
        bLunch = category(b, ledgerB, "B점심", CategoryKind.EXPENSE, bFood);
        bSpare = category(b, ledgerB, "B안쓰는분류", CategoryKind.EXPENSE, null);
        bUncategorized = categoryService.uncategorized(ledgerB, CategoryKind.EXPENSE).getId();
        bExpense = transactionService.create(b, ledgerB, new Entry(UUID.randomUUID(), TransactionType.EXPENSE,
                DAY, null, bBank, bLunch, 73_100, false, "B단골식당", "B의메모", null), DEVICE);
        bTransfer = fixtures.transfer(userB, ledgerB, bBank, bCash, DAY, 41_700);
        bDeleted = fixtures.delete(userB, fixtures.expense(userB, ledgerB, bBank, bFood, DAY, 58_300));
        bCanceled = fixtures.cancel(userB, fixtures.expense(userB, ledgerB, bBank, bFood, DAY, 66_900));

        secretsOfB = List.of("B월급통장", "B비상금", "B빈계좌", "B식비", "B점심", "B안쓰는분류", "B단골식당", "B의메모",
                "5432100", "5,432,100", "73100", "73,100", "41700", "41,700", "58300", "58,300", "66900", "66,900",
                "b@example.com", ledgerB.toString(), bBank.toString(), bCash.toString(), bEmptyAccount.toString(),
                bFood.toString(), bLunch.toString(), bSpare.toString(), bUncategorized.toString(),
                bExpense.id().toString(), bTransfer.id().toString(), bDeleted.id().toString(),
                bCanceled.id().toString());
        baseline = snapshot();

        accountService = recorded(accountService);
        categoryService = recorded(categoryService);
        transactionService = recorded(transactionService);
        transactionListQuery = recorded(transactionListQuery);
        categorySuggestionQuery = recorded(categorySuggestionQuery);
        transactionExportQuery = recorded(transactionExportQuery);
        balanceQuery = recorded(balanceQuery);
        monthlyStatsQuery = recorded(monthlyStatsQuery);
        ledgerAccess = recorded(ledgerAccess);
        ledgerService = recorded(ledgerService);
        userService = recorded(userService);
    }

    @TestFactory
    Stream<DynamicTest> A는_B의_장부에_닿을_수_없다() {
        return Stream.concat(
                rows().map(row -> dynamicTest(row.label(), () -> verify(row))),
                Stream.of(
                        dynamicTest("구성원 확인: 예외 없이 답하는 isMember", this::verifyIsMember),
                        dynamicTest("내 정보: 대상 없이 호출자의 것만 답한다", this::verifyOwnInfo),
                        dynamicTest("표시 이름 바꾸기: 대상 없이 호출자의 것만 바꾼다", this::verifyOwnDisplayName),
                        dynamicTest("표가 호출자를 받는 공개 메서드를 모두 다룬다", this::verifyTableCoversInventory)));
    }

    /** {@code isMember}는 거부를 예외가 아니라 false로 답해 표의 줄 모양에 맞지 않는다. 같은 것을 값으로 본다. */
    void verifyIsMember() {
        assertThat(asA(() -> ledgerAccess.isMember(a, ledgerB))).as("A가 B의 장부").isFalse();
        assertThat(ledgerAccess.isMember(a, missing)).as("A가 없는 장부").isFalse();
        assertThat(ledgerAccess.isMember(b, ledgerB)).as("대조: B가 자기 장부").isTrue();
        assertThat(snapshot()).isEqualTo(baseline);
    }

    /**
     * 내 정보와 내 장부 목록(#30)은 대상 id를 받지 않아 표의 줄 모양에 맞지 않는다. 호출자 말고 다른 사람을
     * 가리킬 길이 없으므로, A가 부른 결과가 A의 것뿐이고 B의 값이 없는지를 값으로 본다.
     */
    void verifyOwnInfo() {
        UserProfile profile = asA(() -> userService.profile(a));
        assertThat(profile.email()).isEqualTo("a@example.com");
        assertThat(profile.toString()).doesNotContain(secretsOfB);
        List<LedgerMembership> ledgers = asA(() -> ledgerService.memberships(a));
        assertThat(ledgers).extracting(LedgerMembership::ledgerId).containsExactly(ledgerA);
        assertThat(ledgers.toString()).doesNotContain(secretsOfB);
        assertThat(ledgerService.memberships(b)).as("대조: B는 자기 장부").extracting(LedgerMembership::ledgerId)
                .containsExactly(ledgerB);
        assertThat(snapshot()).isEqualTo(baseline);
    }

    /**
     * 표시 이름 바꾸기(#68)도 대상 id를 받지 않는다. A가 부르면 A의 이름만 바뀌고 돌려준 값에 B의 것이 없다.
     * 바꾼 것은 SAVEPOINT로 되돌린다.
     */
    void verifyOwnDisplayName() {
        Throwable failure = rolledBack(() -> {
            UserProfile profile = asA(() -> userService.changeDisplayName(a, "A새이름"));
            assertThat(profile).isEqualTo(new UserProfile("a@example.com", "A새이름"));
            assertThat(jdbc.queryForList("select display_name from users where id in (?, ?) order by email",
                    String.class, a, b)).containsExactly("A새이름", "b");
        });
        assertThat(failure).isNull();
        assertThat(snapshot()).isEqualTo(baseline);
    }

    /**
     * 새 공개 메서드가 표에서 빠지는 것을 막는다. 앞의 줄이 실패해도 호출은 기록되므로 이 줄은 따로 판정된다.
     * 서비스 클래스가 새로 생기면 {@link #setUp()}에서 감싸고 표에 줄을 더한다.
     */
    void verifyTableCoversInventory() {
        assertThat(calledByA)
                .as("호출자(actorId)를 받는 공개 메서드는 모두 이 표에서 A가 B의 대상으로 불러 봐야 한다. "
                        + "빠진 메서드가 있으면 표에 줄을 더한다")
                .containsAll(ServiceMethodInventoryTest.actorMethodNames());
    }

    /**
     * 다른 장부에 이미 있는 거래 id로 내 장부에 만들기는 "없는 id"와 같을 수 없다(없는 id면 만들어진다).
     * ADR 006 결정 3: B의 거래가 어떤 상태든 답이 같은 고정 문구의 {@link IdConflictException}이고 아무것도 담지 않는다.
     * 거래를 담는 것은 내가 만든 거래의 id에 다른 내용을 보낸 충돌뿐이다.
     */
    @Test
    void B의_거래_id로_A의_장부에_만들면_답이_모두_같고_B의_거래를_담지_않는다() {
        List<IdConflictException> answers = Stream.of(bExpense, bTransfer, bDeleted, bCanceled)
                .map(tx -> catchThrowableOfType(IdConflictException.class, () -> transactionService.create(a, ledgerA,
                        entry(tx.id(), aBank, aFood, 9_999), DEVICE)))
                .toList();

        assertThat(answers).allSatisfy(denied -> {
            assertThat(denied).isExactlyInstanceOf(IdConflictException.class);
            assertThat(denied.current()).isEmpty();
            assertNoSecret(denied);
            assertSameAnswer(denied, answers.getFirst());
        });
        IdConflictException ownIdOtherContent = catchThrowableOfType(IdConflictException.class,
                () -> transactionService.create(a, ledgerA, entry(aExpense.id(), aBank, aFood, 9_999), DEVICE));
        assertThat(ownIdOtherContent.current()).contains(aExpense);
        assertThat(snapshot()).isEqualTo(baseline);
    }

    /** 거부와 별개로, A가 자기 장부를 조회한 결과에 B의 것이 섞이지 않는다. */
    @Test
    void A의_장부_조회에_B의_데이터가_섞이지_않는다() {
        assertThat(accountService.list(a, ledgerA)).extracting(Account::getId)
                .containsExactlyInAnyOrder(aBank, aCash);
        assertThat(categoryService.list(a, ledgerA)).extracting(Category::getLedgerId).containsOnly(ledgerA);
        assertThat(transactionService.listDeleted(a, ledgerA)).extracting(TransactionView::id)
                .containsExactly(aDeleted.id());
        assertThat(transactionListQuery.page(a, ledgerA, new WholeLedger(), null, 50).items())
                .extracting(TransactionView::id).containsExactlyInAnyOrder(aExpense.id(), aTransfer.id());
        // 100,000 - 지출 1,100 - 이체 2,200. 삭제한 3,300은 빠진다.
        assertThat(balanceQuery.balances(a, ledgerA))
                .containsOnly(Map.entry(aBank, 96_700L), Map.entry(aCash, 2_200L));
        assertThat(transactionListQuery.dailyTotals(a, ledgerA, NOVEMBER)).containsExactly(new DayTotals(DAY, 0, 1_100));
        MonthlySummary summary = monthlyStatsQuery.monthly(a, ledgerA, NOVEMBER);
        assertThat(summary.expense()).isEqualTo(1_100);
        assertThat(summary.income()).isZero();
        assertThat(summary.categories()).extracting(total -> total.categoryId()).containsExactly(aFood);
    }

    // ---------------------------------------------------------------- 표

    Stream<Row> rows() {
        return Stream.of(readRows(), createRows(), referenceRows(), changeRows(), removeRows(), orderRows())
                .flatMap(Function.identity());
    }

    /** 조회: 계좌, 카테고리, 거래(지출, 이체, 삭제, 취소), 변경 이력, 휴지통, 잔액, 월 통계, 구성원·소유자 확인. */
    Stream<Row> readRows() {
        return Stream.of(
                denied("조회: 계좌 목록", NotLedgerMemberException.class, ledgerB,
                        (actor, ledger) -> accountService.list(actor, ledger)),
                denied("조회: 카테고리 목록", NotLedgerMemberException.class, ledgerB,
                        (actor, ledger) -> categoryService.list(actor, ledger)),
                denied("조회: 거래(지출)", NotFoundException.class, bExpense.id(),
                        (actor, tx) -> transactionService.get(actor, tx)),
                denied("조회: 거래(이체)", NotFoundException.class, bTransfer.id(),
                        (actor, tx) -> transactionService.get(actor, tx)),
                denied("조회: 거래(삭제한 것)", NotFoundException.class, bDeleted.id(),
                        (actor, tx) -> transactionService.get(actor, tx)),
                denied("조회: 거래(취소한 것)", NotFoundException.class, bCanceled.id(),
                        (actor, tx) -> transactionService.get(actor, tx)),
                denied("조회: 변경 이력", NotFoundException.class, bExpense.id(),
                        (actor, tx) -> transactionService.history(actor, tx)),
                denied("조회: 변경 이력(삭제한 거래)", NotFoundException.class, bDeleted.id(),
                        (actor, tx) -> transactionService.history(actor, tx)),
                denied("조회: 휴지통", NotLedgerMemberException.class, ledgerB,
                        (actor, ledger) -> transactionService.listDeleted(actor, ledger)),
                denied("조회: 거래 목록(달)", NotLedgerMemberException.class, ledgerB,
                        (actor, ledger) -> transactionListQuery.page(actor, ledger, new Month(NOVEMBER), null, 50)),
                denied("조회: 거래 목록(하루)", NotLedgerMemberException.class, ledgerB,
                        (actor, ledger) -> transactionListQuery.page(actor, ledger, new Day(DAY), null, 50)),
                denied("조회: 거래 목록(장부 전체)", NotLedgerMemberException.class, ledgerB,
                        (actor, ledger) -> transactionListQuery.page(actor, ledger, new WholeLedger(), null, 50)),
                denied("조회: 중복 경고", NotLedgerMemberException.class, ledgerB, (actor, ledger) ->
                        transactionListQuery.duplicates(actor, ledger, DAY, 73_100, "B단골식당", null)),
                denied("조회: 가맹점의 최근 카테고리 제안", NotLedgerMemberException.class, ledgerB,
                        (actor, ledger) -> categorySuggestionQuery.suggest(actor, ledger, "B단골식당")),
                denied("조회: 날짜별 합계(달력)", NotLedgerMemberException.class, ledgerB,
                        (actor, ledger) -> transactionListQuery.dailyTotals(actor, ledger, NOVEMBER)),
                denied("조회: 내보내기", NotLedgerMemberException.class, ledgerB,
                        (actor, ledger) -> transactionExportQuery.transactions(actor, ledger, DAY, DAY)),
                denied("조회: 계좌 잔액", NotLedgerMemberException.class, bBank,
                        (actor, account) -> balanceQuery.balance(actor, account)),
                denied("조회: 장부의 모든 잔액", NotLedgerMemberException.class, ledgerB,
                        (actor, ledger) -> balanceQuery.balances(actor, ledger)),
                denied("조회: 월 통계", NotLedgerMemberException.class, ledgerB,
                        (actor, ledger) -> monthlyStatsQuery.monthly(actor, ledger, NOVEMBER)),
                denied("구성원 확인: B의 장부", NotLedgerMemberException.class, ledgerB,
                        (actor, ledger) -> ledgerAccess.requireMember(actor, ledger)),
                denied("소유자 확인: B의 장부", NotLedgerOwnerException.class, ledgerB,
                        (actor, ledger) -> ledgerAccess.requireOwner(actor, ledger)),
                denied("조회: 구성원의 표시 이름", NotLedgerMemberException.class, ledgerB,
                        (actor, ledger) -> userService.memberDisplayNames(actor, ledger)));
    }

    /** 생성: B의 장부에 만들기. 요청 내용은 B가 보내면 그대로 통과하는 것이다. */
    Stream<Row> createRows() {
        return Stream.of(
                denied("생성: B의 장부에 계좌", NotLedgerMemberException.class, ledgerB,
                        (actor, ledger) -> accountService.create(actor, ledger, accountCommand("새계좌"))),
                denied("생성: B의 장부에 카테고리", NotLedgerMemberException.class, ledgerB,
                        (actor, ledger) -> categoryService.create(actor, ledger,
                                new CategoryCommand("새분류", CategoryKind.EXPENSE, null))),
                denied("생성: B의 장부에 하위 카테고리", NotLedgerMemberException.class, ledgerB,
                        (actor, ledger) -> categoryService.create(actor, ledger,
                                new CategoryCommand("새하위", CategoryKind.EXPENSE, bFood))),
                // 대조: B의 장부에는 이미 기본 카테고리(미분류)가 있어 B도 DB 유일 제약에 걸린다.
                denied("생성: B의 장부에 기본 카테고리", NotLedgerOwnerException.class, ledgerB,
                        DataIntegrityViolationException.class,
                        (actor, ledger) -> categoryService.createDefaults(actor, ledger)),
                denied("생성: B의 장부에 지출", NotLedgerMemberException.class, ledgerB,
                        (actor, ledger) -> transactionService.create(actor, ledger,
                                entry(UUID.randomUUID(), bBank, bFood, 1_000), DEVICE)),
                denied("생성: B의 장부에 지출(재전송 구분)", NotLedgerMemberException.class, ledgerB,
                        (actor, ledger) -> transactionService.createOrReplay(actor, ledger,
                                entry(UUID.randomUUID(), bBank, bFood, 1_000), DEVICE)),
                denied("생성: B의 장부에 이체", NotLedgerMemberException.class, ledgerB,
                        (actor, ledger) -> transactionService.create(actor, ledger,
                                transfer(UUID.randomUUID(), bBank, bCash, 1_000), DEVICE)));
    }

    /**
     * A의 장부에 만들거나 A의 거래를 고치면서 B의 것을 끼워 넣기. 대조는 A가 자기 것을 넣는 요청이다.
     * 거부는 "장부에 없다"는 입력 오류이고, 없는 id를 넣었을 때와 같다.
     */
    Stream<Row> referenceRows() {
        Class<InvalidRequestException> invalid = InvalidRequestException.class;
        return Stream.of(
                foreign("생성: A의 지출에 B의 계좌", invalid, bBank, aCash,
                        (actor, account) -> transactionService.create(actor, ledgerA,
                                entry(UUID.randomUUID(), account, aFood, 1_000), DEVICE)),
                foreign("생성: A의 지출에 B의 카테고리", invalid, bFood, aFood,
                        (actor, category) -> transactionService.create(actor, ledgerA,
                                entry(UUID.randomUUID(), aBank, category, 1_000), DEVICE)),
                foreign("생성: A의 이체에서 보내는 계좌가 B의 계좌", invalid, bBank, aCash,
                        (actor, account) -> transactionService.create(actor, ledgerA,
                                transfer(UUID.randomUUID(), account, aBank, 1_000), DEVICE)),
                foreign("생성: A의 이체에서 받는 계좌가 B의 계좌", invalid, bBank, aCash,
                        (actor, account) -> transactionService.create(actor, ledgerA,
                                transfer(UUID.randomUUID(), aBank, account, 1_000), DEVICE)),
                foreign("생성: A의 지출에 결제한 사람으로 B", invalid, b, a,
                        (actor, payer) -> transactionService.create(actor, ledgerA,
                                new Entry(UUID.randomUUID(), TransactionType.EXPENSE, DAY, null, aBank, aFood, 1_000,
                                        false, null, null, payer), DEVICE)),
                foreign("생성: A의 카테고리의 상위로 B의 카테고리", invalid, bFood, aFood,
                        (actor, parent) -> categoryService.create(actor, ledgerA,
                                new CategoryCommand("A하위", CategoryKind.EXPENSE, parent))),
                foreign("수정: A의 지출을 B의 계좌로", invalid, bBank, aCash,
                        (actor, account) -> transactionService.update(actor, aExpense.id(), aExpense.version(),
                                entry(aExpense.id(), account, aFood, 1_100), DEVICE)),
                foreign("수정: A의 지출을 B의 카테고리로", invalid, bFood, aFood,
                        (actor, category) -> transactionService.update(actor, aExpense.id(), aExpense.version(),
                                entry(aExpense.id(), aBank, category, 1_100), DEVICE)),
                foreign("수정: A의 이체에서 보내는 계좌를 B의 계좌로", invalid, bBank, aBank,
                        (actor, account) -> transactionService.update(actor, aTransfer.id(), aTransfer.version(),
                                transfer(aTransfer.id(), account, aCash, 2_200), DEVICE)),
                foreign("수정: A의 이체에서 받는 계좌를 B의 계좌로", invalid, bBank, aCash,
                        (actor, account) -> transactionService.update(actor, aTransfer.id(), aTransfer.version(),
                                transfer(aTransfer.id(), aBank, account, 2_200), DEVICE)));
    }

    /** 수정·취소. version은 지금 값이고 요청 내용은 B가 보내면 통과하는 것이다. */
    Stream<Row> changeRows() {
        return Stream.of(
                denied("수정: B의 계좌", NotLedgerMemberException.class, bBank,
                        (actor, account) -> accountService.update(actor, ledgerB, account, accountCommand("바꾼이름"))),
                foreign("수정: A의 장부로 B의 계좌", NotLedgerMemberException.class, bBank, aCash,
                        (actor, account) -> accountService.update(actor, ledgerA, account, accountCommand("바꾼이름"))),
                denied("숨기기: B의 계좌", NotLedgerMemberException.class, bBank,
                        (actor, account) -> accountService.setHidden(actor, ledgerB, account, true)),
                foreign("숨기기: A의 장부로 B의 계좌", NotLedgerMemberException.class, bBank, aCash,
                        (actor, account) -> accountService.setHidden(actor, ledgerA, account, true)),
                denied("수정: B의 카테고리 이름", NotLedgerMemberException.class, bFood,
                        (actor, category) -> categoryService.rename(actor, ledgerB, category, "바꾼이름")),
                foreign("수정: A의 장부로 B의 카테고리 이름", NotLedgerMemberException.class, bFood, aFood,
                        (actor, category) -> categoryService.rename(actor, ledgerA, category, "바꾼이름")),
                denied("수정: B의 지출", NotFoundException.class, bExpense.id(),
                        (actor, tx) -> transactionService.update(actor, tx, bExpense.version(),
                                entry(tx, bCash, bFood, 1), DEVICE)),
                denied("수정: B의 이체", NotFoundException.class, bTransfer.id(),
                        (actor, tx) -> transactionService.update(actor, tx, bTransfer.version(),
                                transfer(tx, bCash, bBank, 1), DEVICE)),
                denied("수정: B의 지출을 A의 계좌·카테고리로", NotFoundException.class, bExpense.id(),
                        InvalidRequestException.class,
                        (actor, tx) -> transactionService.update(actor, tx, bExpense.version(),
                                entry(tx, aBank, aFood, 1), DEVICE)),
                denied("취소: B의 지출", NotFoundException.class, bExpense.id(),
                        (actor, tx) -> transactionService.cancel(actor, tx, bExpense.version(), DEVICE)),
                denied("취소: B의 이체", NotFoundException.class, bTransfer.id(),
                        (actor, tx) -> transactionService.cancel(actor, tx, bTransfer.version(), DEVICE)));
    }

    /** 삭제·복원. */
    Stream<Row> removeRows() {
        return Stream.of(
                denied("삭제: B의 계좌(거래 없음)", NotLedgerMemberException.class, bEmptyAccount,
                        (actor, account) -> accountService.delete(actor, ledgerB, account)),
                // 대조: A의 장부로 A의 계좌는 거래가 있다는 데까지 간다.
                new Row("삭제: A의 장부로 B의 계좌(거래 없음)", NotLedgerMemberException.class, bEmptyAccount,
                        (actor, account) -> accountService.delete(actor, ledgerA, account), a, aBank,
                        AccountHasTransactionsException.class),
                denied("삭제: B의 카테고리(거래 없음)", NotLedgerMemberException.class, bSpare,
                        (actor, category) -> categoryService.delete(actor, category)),
                denied("삭제: B의 지출", NotFoundException.class, bExpense.id(),
                        (actor, tx) -> transactionService.delete(actor, tx, bExpense.version(), DEVICE)),
                denied("삭제: B의 이체", NotFoundException.class, bTransfer.id(),
                        (actor, tx) -> transactionService.delete(actor, tx, bTransfer.version(), DEVICE)),
                denied("삭제: B의 취소한 거래", NotFoundException.class, bCanceled.id(),
                        (actor, tx) -> transactionService.delete(actor, tx, bCanceled.version(), DEVICE)),
                denied("복원: B의 삭제한 거래", NotFoundException.class, bDeleted.id(),
                        (actor, tx) -> transactionService.restore(actor, tx, bDeleted.version(), DEVICE)));
    }

    /**
     * 권한 확인이 다른 검사보다 먼저다. B가 보내면 대상의 상태나 입력 오류를 알려 주는 요청도
     * A에게는 없는 대상과 똑같이 답한다. 대조 칸은 B가 받는 오류다.
     */
    Stream<Row> orderRows() {
        Class<NotLedgerMemberException> notMember = NotLedgerMemberException.class;
        Class<NotFoundException> notFound = NotFoundException.class;
        Class<InvalidRequestException> invalid = InvalidRequestException.class;
        Class<InvalidStateException> state = InvalidStateException.class;
        return Stream.of(
                denied("순서: 거래가 있는 B의 계좌 삭제", notMember, bBank, AccountHasTransactionsException.class,
                        (actor, account) -> accountService.delete(actor, ledgerB, account)),
                denied("순서: B의 계좌를 값 없이 숨기기", notMember, bBank, invalid,
                        (actor, account) -> accountService.setHidden(actor, ledgerB, account, null)),
                denied("순서: 하위 분류가 있는 B의 카테고리 삭제", notMember, bFood, InUseException.class,
                        (actor, category) -> categoryService.delete(actor, category)),
                denied("순서: B의 미분류 이름 바꾸기", notMember, bUncategorized, state,
                        (actor, category) -> categoryService.rename(actor, ledgerB, category, "바꾼이름")),
                denied("순서: B의 미분류 삭제", notMember, bUncategorized, invalid,
                        (actor, category) -> categoryService.delete(actor, category)),
                denied("순서: B의 계좌를 빈 요청으로 수정", notMember, bBank, invalid,
                        (actor, account) -> accountService.update(actor, ledgerB, account, null)),
                denied("순서: B의 카테고리를 빈 이름으로", notMember, bFood, invalid,
                        (actor, category) -> categoryService.rename(actor, ledgerB, category, " ")),
                denied("순서: B의 장부에 빈 계좌 요청", notMember, ledgerB, invalid,
                        (actor, ledger) -> accountService.create(actor, ledger, null)),
                denied("순서: B의 장부에 빈 카테고리 요청", notMember, ledgerB, invalid,
                        (actor, ledger) -> categoryService.create(actor, ledger, null)),
                denied("순서: B의 장부에 빈 거래 요청", notMember, ledgerB, invalid,
                        (actor, ledger) -> transactionService.create(actor, ledger, null, DEVICE)),
                denied("순서: B의 장부 월 통계를 달 없이", notMember, ledgerB, invalid,
                        (actor, ledger) -> monthlyStatsQuery.monthly(actor, ledger, null)),
                denied("순서: B의 장부 월 통계를 범위 밖 달로", notMember, ledgerB, invalid,
                        (actor, ledger) -> monthlyStatsQuery.monthly(actor, ledger, YearMonth.of(1999, 12))),
                denied("순서: B의 장부 거래 목록을 범위 밖 limit으로", notMember, ledgerB, invalid,
                        (actor, ledger) -> transactionListQuery.page(actor, ledger, new Month(NOVEMBER), null, 0)),
                denied("순서: B의 장부에 101자 가맹점으로 중복 경고", notMember, ledgerB, invalid, (actor, ledger) ->
                        transactionListQuery.duplicates(actor, ledger, DAY, 73_100, "가".repeat(101), null)),
                denied("순서: B의 장부에 101자 가맹점으로 카테고리 제안", notMember, ledgerB, invalid,
                        (actor, ledger) -> categorySuggestionQuery.suggest(actor, ledger, "가".repeat(101))),
                denied("순서: B의 장부 날짜별 합계를 범위 밖 달로", notMember, ledgerB, invalid,
                        (actor, ledger) -> transactionListQuery.dailyTotals(actor, ledger, YearMonth.of(1999, 12))),
                denied("순서: B의 지출을 낡은 version으로 취소", notFound, bExpense.id(), StaleVersionException.class,
                        (actor, tx) -> transactionService.cancel(actor, tx, bExpense.version() + 1, DEVICE)),
                denied("순서: B의 지출을 빈 요청으로 수정", notFound, bExpense.id(), invalid,
                        (actor, tx) -> transactionService.update(actor, tx, bExpense.version(), null, DEVICE)),
                denied("순서: B의 취소한 거래를 다시 취소", notFound, bCanceled.id(), state,
                        (actor, tx) -> transactionService.cancel(actor, tx, bCanceled.version(), DEVICE)),
                denied("순서: B의 삭제한 거래를 수정", notFound, bDeleted.id(), state,
                        (actor, tx) -> transactionService.update(actor, tx, bDeleted.version(),
                                entry(tx, bBank, bFood, 1), DEVICE)),
                denied("순서: B의 삭제한 거래를 다시 삭제", notFound, bDeleted.id(), state,
                        (actor, tx) -> transactionService.delete(actor, tx, bDeleted.version(), DEVICE)),
                denied("순서: B의 삭제하지 않은 거래를 복원", notFound, bExpense.id(), state,
                        (actor, tx) -> transactionService.restore(actor, tx, bExpense.version(), DEVICE)),
                denied("순서: B의 장부에 형식이 틀린 기기 값으로 지출", notMember, ledgerB, invalid,
                        (actor, ledger) -> transactionService.create(actor, ledger,
                                entry(UUID.randomUUID(), bBank, bFood, 1_000), MALFORMED_DEVICE)),
                denied("순서: B의 지출을 형식이 틀린 기기 값으로 수정", notFound, bExpense.id(), invalid,
                        (actor, tx) -> transactionService.update(actor, tx, bExpense.version(),
                                entry(tx, bCash, bFood, 1), MALFORMED_DEVICE)),
                denied("순서: B의 지출을 형식이 틀린 기기 값으로 취소", notFound, bExpense.id(), invalid,
                        (actor, tx) -> transactionService.cancel(actor, tx, bExpense.version(), MALFORMED_DEVICE)),
                denied("순서: B의 지출을 형식이 틀린 기기 값으로 삭제", notFound, bExpense.id(), invalid,
                        (actor, tx) -> transactionService.delete(actor, tx, bExpense.version(), MALFORMED_DEVICE)),
                denied("순서: B의 삭제한 거래를 형식이 틀린 기기 값으로 복원", notFound, bDeleted.id(), invalid,
                        (actor, tx) -> transactionService.restore(actor, tx, bDeleted.version(), MALFORMED_DEVICE)));
    }

    // ---------------------------------------------------------------- 확인

    void verify(Row row) {
        Throwable denied = asA(() -> catchThrowable(() -> row.call().run(a, row.target())));
        assertThat(denied).as("A가 B의 대상으로 요청").isExactlyInstanceOf(row.expected());
        assertNoSecret(denied);

        Throwable absent = catchThrowable(() -> row.call().run(a, missing));
        assertThat(absent).as("A가 없는 id로 요청").isNotNull();
        assertSameAnswer(denied, absent);

        assertThat(snapshot()).as("거부한 뒤 DB").isEqualTo(baseline);

        Throwable control = rolledBack(() -> row.call().run(row.controlActor(), row.controlTarget()));
        if (row.controlExpected() == null) {
            assertThat(control).as("대조: 권한이 있는 쪽의 같은 요청").isNull();
        } else {
            assertThat(control).as("대조: 권한이 있는 쪽이 받는 오류").isExactlyInstanceOf(row.controlExpected());
        }
        assertThat(snapshot()).as("대조 요청을 되돌린 뒤 DB").isEqualTo(baseline);
    }

    /** P-903: 예외의 종류와 메시지가 같아 둘을 구분할 수 없다. */
    static void assertSameAnswer(Throwable denied, Throwable other) {
        assertThat(denied.getClass()).isEqualTo(other.getClass());
        assertThat(denied.getMessage()).isEqualTo(other.getMessage());
    }

    void assertNoSecret(Throwable denied) {
        assertThat(String.valueOf(denied.getMessage())).doesNotContain(secretsOfB);
        assertThat(denied.getCause()).isNull();
    }

    /** 거부 단계의 요청만 기록한다. 없는 id로 한 요청과 대조 요청은 "표가 다뤘다"로 치지 않는다. */
    <T> T asA(Supplier<T> request) {
        recording = true;
        try {
            return request.get();
        } finally {
            recording = false;
        }
    }

    /** 서비스를 감싸, 거부 단계에서 A가 부른 메서드를 "클래스.메서드"로 적어 둔다. 동작은 바꾸지 않는다. */
    @SuppressWarnings("unchecked")
    <T> T recorded(T service) {
        String type = AopUtils.getTargetClass(service).getSimpleName();
        ProxyFactory factory = new ProxyFactory(service);
        factory.setProxyTargetClass(true);
        factory.addAdvice((MethodInterceptor) invocation -> {
            Object[] arguments = invocation.getArguments();
            if (recording && arguments.length > 0 && a.equals(arguments[0])) {
                calledByA.add(type + "." + invocation.getMethod().getName());
            }
            return invocation.proceed();
        });
        return (T) factory.getProxy();
    }

    /** 요청을 실행하고 SAVEPOINT로 되돌린다. 영속성 컨텍스트도 비워 다음 줄이 DB에서 다시 읽게 한다. */
    Throwable rolledBack(Request request) {
        entityManager.flush();
        jdbc.execute("SAVEPOINT cross_ledger_control");
        try {
            return catchThrowable(() -> {
                request.run();
                entityManager.flush();
            });
        } finally {
            jdbc.execute("ROLLBACK TO SAVEPOINT cross_ledger_control");
            entityManager.clear();
        }
    }

    /** flyway 이력을 뺀 모든 테이블의 모든 행. 새 테이블이 생겨도 자동으로 들어간다. */
    Map<String, List<Map<String, Object>>> snapshot() {
        entityManager.flush();
        List<String> tables = jdbc.queryForList("""
                select table_name from information_schema.tables
                 where table_schema = 'public' and table_type = 'BASE TABLE'
                   and table_name <> 'flyway_schema_history'
                """, String.class);
        return tables.stream().collect(Collectors.toMap(Function.identity(),
                table -> jdbc.queryForList("select * from \"" + table + "\" order by id")));
    }

    // ---------------------------------------------------------------- 도우미

    UUID category(UUID actor, UUID ledgerId, String name, CategoryKind kind, UUID parentId) {
        return categoryService.create(actor, ledgerId, new CategoryCommand(name, kind, parentId)).getId();
    }

    static AccountCommand accountCommand(String name) {
        return new AccountCommand(name, AccountType.BANK, 0, OPENING);
    }

    static TransactionCommand entry(UUID id, UUID accountId, UUID categoryId, long amount) {
        return new Entry(id, TransactionType.EXPENSE, DAY, null, accountId, categoryId, amount, false, null, null,
                null);
    }

    static TransactionCommand transfer(UUID id, UUID fromAccountId, UUID toAccountId, long amount) {
        return new Transfer(id, DAY, null, fromAccountId, toAccountId, amount, null);
    }

    /** A가 B의 대상에 요청한다. 대조는 B가 같은 요청을 하는 것이고 통과해야 한다. */
    Row denied(String label, Class<? extends Throwable> expected, UUID target, Call call) {
        return new Row(label, expected, target, call, b, target, null);
    }

    /** 대조에서 B도 오류를 받는 요청. 그 오류는 A에게 보이면 안 되는 정보다. */
    Row denied(String label, Class<? extends Throwable> expected, UUID target,
               Class<? extends Throwable> controlExpected, Call call) {
        return new Row(label, expected, target, call, b, target, controlExpected);
    }

    /** A가 자기 장부의 요청에 B의 것을 넣는다. 대조는 A가 자기 것(own)을 넣는 것이다. */
    Row foreign(String label, Class<? extends Throwable> expected, UUID target, UUID own, Call call) {
        return new Row(label, expected, target, call, a, own, null);
    }

    /**
     * 표의 한 줄.
     *
     * @param expected        A가 받아야 하는 예외
     * @param target          B의 대상(장부, 계좌, 카테고리, 거래, 사용자) id
     * @param controlExpected 대조 요청이 받는 예외. null이면 통과한다
     */
    record Row(String label, Class<? extends Throwable> expected, UUID target, Call call,
               UUID controlActor, UUID controlTarget, Class<? extends Throwable> controlExpected) {
    }

    @FunctionalInterface
    interface Call {
        void run(UUID actorId, UUID targetId);
    }

    @FunctionalInterface
    interface Request {
        void run();
    }
}
