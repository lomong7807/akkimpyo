package app.accountbook.transaction;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.account.AccountType;
import app.accountbook.category.CategoryCommand;
import app.accountbook.category.CategoryKind;
import app.accountbook.category.CategoryRepository;
import app.accountbook.category.CategoryService;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.user.User;
import jakarta.persistence.EntityManager;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import java.util.stream.IntStream;
import java.util.stream.Stream;
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import tools.jackson.databind.JsonNode;

/**
 * 카테고리 삭제의 거래 옮기기와 영향받는 거래 수(P-222, F-512, #3). 옮길 곳의 규칙과 미분류는 CategoryServiceTest,
 * 옮길 곳이 없을 때와 이력 응답은 api.CategoryDeleteHistoryTest가 본다.
 */
@IntegrationTest
class CategoryDeleteTest {

    static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    static final String DEVICE = "mac.chrome";

    @Autowired CategoryService categoryService;
    @Autowired TransactionService transactionService;
    @Autowired TransactionRepository transactionRepository;
    @Autowired ChangeLogRepository changeLogRepository;
    @Autowired CategoryRepository categoryRepository;
    @Autowired Fixtures fixtures;
    @Autowired EntityManager entityManager;

    User user;
    UUID owner;
    UUID ledgerId;
    UUID cash;
    UUID food;
    UUID lunch;
    UUID leisure;

    @BeforeEach
    void setUp() {
        user = fixtures.user("owner@example.com");
        owner = user.getId();
        ledgerId = fixtures.personalLedgerId(user);
        cash = fixtures.account(user, ledgerId, "현금", AccountType.CASH, 0, LocalDate.of(2026, 11, 1)).getId();
        food = category("식비", CategoryKind.EXPENSE, null);
        lunch = category("점심", CategoryKind.EXPENSE, food);
        leisure = category("여가", CategoryKind.EXPENSE, null);
    }

    @Test
    void 하위와_휴지통과_취소한_거래의_라인까지_고른_카테고리로_옮기고_카테고리와_하위를_지운다() {
        TransactionView meal = expense(food);
        TransactionView trashed = fixtures.delete(user, expense(lunch));
        TransactionView canceled = fixtures.cancel(user, expense(lunch));

        categoryService.delete(owner, ledgerId, food, leisure, DEVICE);

        assertThat(Stream.of(meal, trashed, canceled).map(this::categoryOf)).containsOnly(leisure);
        assertThat(stored(trashed).deleted()).isTrue();
        assertThat(stored(canceled).status()).isEqualTo(TransactionStatus.CANCELED);
        assertThat(categoryRepository.findAllById(List.of(food, lunch))).isEmpty();
    }

    /**
     * 후 값은 옮긴 뒤 DB의 거래와 같고 전 값은 바로 앞 이력의 후 값과 같다. 라인이 둘인 거래(기능으로는 아직 만들 수 없어 바로
     * 저장한다)도 이력은 하나다. 옮기지 않은 거래는 그대로다.
     */
    @Test
    void 옮긴_거래마다_카테고리_이동_이력이_하나_남고_version이_오른다() {
        TransactionView meal = fixtures.delete(user, expense(lunch));
        Transaction split = transactionRepository.saveAndFlush(Transaction.of(UUID.randomUUID(), ledgerId,
                TransactionType.EXPENSE, DAY, null, null, null, owner, owner)
                .addLine(cash, food, -1_000).addLine(cash, lunch, -2_000));
        TransactionView untouched = expense(leisure);

        categoryService.delete(owner, ledgerId, food, leisure, DEVICE);

        List<ChangeLog> mealLogs = changeLogRepository.findByTransactionIdOrderByVersionAsc(meal.id());
        assertThat(mealLogs).extracting(ChangeLog::getAction)
                .containsExactly(ChangeAction.CREATE, ChangeAction.DELETE, ChangeAction.CATEGORY_MOVE);
        assertThat(value(mealLogs.get(2).getBeforeValue())).isEqualTo(value(mealLogs.get(1).getAfterValue()));
        assertThat(mealLogs.get(2).getCreatedAt()).isAfter(mealLogs.get(1).getCreatedAt());
        assertThat(stored(meal).version()).isEqualTo(meal.version() + 1);
        List<ChangeLog> splitLogs = changeLogRepository.findByTransactionIdOrderByVersionAsc(split.getId());
        assertThat(splitLogs).singleElement().satisfies(log -> assertThat(value(log.getBeforeValue()).lines())
                .extracting(ChangeLogValue.Line::categoryId).containsExactlyInAnyOrder(food, lunch));
        for (ChangeLog moved : List.of(mealLogs.getLast(), splitLogs.getLast())) {
            Transaction fresh = transactionRepository.findWithLinesById(moved.getTransactionId()).orElseThrow();
            assertThat(fresh.getLines()).extracting(TransactionLine::getCategoryId).containsOnly(leisure);
            assertThat(moved.getActorId()).isEqualTo(owner);
            assertThat(moved.getDeviceId()).isEqualTo(DEVICE);
            // 라인의 순서는 뜻이 없다(ADR 007 결정 4).
            assertThat(value(moved.getAfterValue())).usingRecursiveComparison().ignoringCollectionOrder()
                    .isEqualTo(ChangeLogValue.of(fresh));
        }
        assertThat(stored(untouched).version()).isEqualTo(untouched.version());
        assertThat(changeLogRepository.findByTransactionIdOrderByVersionAsc(untouched.id())).hasSize(1);
    }

    @Test
    void 지우기_전_거래_수는_하위와_휴지통과_취소한_거래를_거래_단위로_센다() {
        expense(food);
        fixtures.delete(user, expense(lunch));
        fixtures.cancel(user, expense(lunch));
        transactionRepository.saveAndFlush(Transaction.of(UUID.randomUUID(), ledgerId, TransactionType.EXPENSE, DAY,
                null, null, null, owner, owner).addLine(cash, food, -1_000).addLine(cash, lunch, -2_000));
        expense(leisure);

        assertThat(categoryService.countAffectedTransactions(owner, ledgerId, food)).isEqualTo(4);
        assertThat(categoryService.countAffectedTransactions(owner, ledgerId, lunch)).isEqualTo(3);
        assertThat(categoryService.countAffectedTransactions(owner, ledgerId, leisure)).isEqualTo(1);
    }

    /** 라인 옮기기와 version 올리기는 한 문장이고 이력은 묶음 하나라, 준비한 문장 수가 옮기는 거래 수에 따라 늘지 않는다. */
    @Test
    void 지우는_문장_수는_옮기는_거래_수와_상관없다() {
        UUID snacks = category("간식", CategoryKind.EXPENSE, null);
        expense(leisure);
        IntStream.range(0, 5).forEach(i -> expense(snacks));
        entityManager.flush();

        long one = statements(() -> categoryService.delete(owner, ledgerId, leisure, null, DEVICE));
        long five = statements(() -> categoryService.delete(owner, ledgerId, snacks, null, DEVICE));

        assertThat(five).isEqualTo(one);
    }

    // ---------------------------------------------------------------- 도우미

    private UUID category(String name, CategoryKind kind, UUID parentId) {
        return categoryService.create(owner, ledgerId, new CategoryCommand(name, kind, parentId)).getId();
    }

    private TransactionView expense(UUID categoryId) {
        return fixtures.expense(user, ledgerId, cash, categoryId, DAY, 12_000);
    }

    private TransactionView stored(TransactionView tx) {
        return transactionService.get(owner, tx.id());
    }

    private UUID categoryOf(TransactionView tx) {
        return stored(tx).lines().getFirst().categoryId();
    }

    private static ChangeLogValue value(JsonNode json) {
        return ChangeLogValue.read(ChangeLogValue.FORMAT_VERSION, json);
    }

    /** 요청 하나에서 Hibernate가 준비한 문장 수(LedgerServiceTest와 같다). */
    private long statements(Runnable request) {
        Statistics statistics = entityManager.getEntityManagerFactory().unwrap(SessionFactory.class).getStatistics();
        statistics.clear();
        statistics.setStatisticsEnabled(true);
        try {
            request.run();
            return statistics.getPrepareStatementCount();
        } finally {
            statistics.setStatisticsEnabled(false);
            statistics.clear();
        }
    }
}
