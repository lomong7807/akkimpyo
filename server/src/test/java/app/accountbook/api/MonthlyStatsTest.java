package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.account.AccountType;
import app.accountbook.api.ServerClient.Reply;
import app.accountbook.category.CategoryCommand;
import app.accountbook.category.CategoryKind;
import app.accountbook.category.CategoryService;
import app.accountbook.support.Fixtures;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.user.User;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.json.JsonMapper;

/**
 * {@code GET /api/v1/ledgers/{ledgerId}/stats/monthly}(#16 응답 계약)의 HTTP 쪽: 응답 모양, month의 오류, 404와 401.
 * 합계 규칙과 달 경계는 {@code MonthlyStatsQueryTest}, 순서와 자르기는 {@code MonthlySummaryTest}가 본다.
 * 시계는 서울 2026-11-27 12:00이다.
 */
@LedgerApiTest
class MonthlyStatsTest {

    private static final Instant NOW = Instant.parse("2026-11-27T03:00:00Z");
    private static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    private static final JsonMapper JSON = new JsonMapper();

    @LocalServerPort int port;
    @Autowired StoppedClock clock;
    @Autowired Fixtures fixtures;
    @Autowired CategoryService categoryService;
    @Autowired JdbcTemplate jdbc;

    private User owner;
    private UUID ledgerId;
    private UUID cash;
    private ServerClient client;
    /** HTTP 테스트는 롤백되지 않는다. 거래를 만든 장부를 적어 두고 끝나면 지운다. */
    private final List<UUID> ledgers = new ArrayList<>();

    @BeforeEach
    void setUp() {
        clock.stopAt(NOW);
        owner = user();
        ledgerId = fixtures.personalLedgerId(owner);
        ledgers.add(ledgerId);
        cash = fixtures.account(owner, ledgerId, "현금", AccountType.CASH, 0, DAY).getId();
        client = ServerClient.signedIn(port, owner.getId(), NOW);
    }

    @AfterEach
    void removeTransactions() {
        ledgers.forEach(ledger -> {
            jdbc.update("delete from change_log where ledger_id = ?", ledger);
            jdbc.update("delete from transaction where ledger_id = ?", ledger);
        });
    }

    /**
     * 지출 카테고리 7개 가운데 0원 이하를 빼고 큰 5개다. 하위(점심)는 상위(식비)에 합치고 미분류도 든다.
     * 합계에는 6번째와 음수인 카테고리도 든다. 이체와 다른 달은 빠진다.
     */
    @Test
    void 응답은_합계와_차액과_지출이_큰_최상위_카테고리_5개다() throws Exception {
        UUID bank = fixtures.account(owner, ledgerId, "은행", AccountType.BANK, 0, DAY).getId();
        UUID food = expenseCategory("식비", null);
        UUID lunch = expenseCategory("점심", food);
        UUID uncategorized = categoryService.uncategorized(ledgerId, CategoryKind.EXPENSE).getId();
        List<UUID> others = List.of(expenseCategory("교통", null), expenseCategory("쇼핑", null),
                expenseCategory("의료", null), expenseCategory("교육", null));
        UUID refunded = expenseCategory("카페", null);
        fixtures.expense(owner, ledgerId, cash, food, DAY, 30_000);
        fixtures.expense(owner, ledgerId, cash, lunch, DAY, 20_000);
        fixtures.expense(owner, ledgerId, cash, null, DAY, 40_000);
        fixtures.expense(owner, ledgerId, cash, others.get(0), DAY, 45_000);
        fixtures.expense(owner, ledgerId, cash, others.get(1), DAY, 10_000);
        fixtures.expense(owner, ledgerId, cash, others.get(2), DAY, 5_000);
        fixtures.expense(owner, ledgerId, cash, others.get(3), DAY, 1_000);
        fixtures.refund(owner, ledgerId, cash, refunded, DAY, 3_000);
        fixtures.income(owner, ledgerId, bank, null, DAY, 3_200_000);
        fixtures.transfer(owner, ledgerId, bank, cash, DAY, 50_000);
        fixtures.expense(owner, ledgerId, cash, food, LocalDate.of(2026, 12, 1), 1_000);

        Reply reply = monthly("month=2026-11");

        assertThat(reply.status()).as(reply.body()).isEqualTo(200);
        assertThat(reply.header("Content-Type")).isEqualTo("application/json");
        // 지출 50,000 + 40,000 + 45,000 + 10,000 + 5,000 + 1,000 - 3,000 = 148,000.
        assertThat(reply.json()).isEqualTo(JSON.readTree("{\"month\":\"2026-11\",\"income\":3200000,"
                + "\"expense\":148000,\"net\":3052000,\"topExpenseCategories\":["
                + top(food, 50_000) + "," + top(others.get(0), 45_000) + "," + top(uncategorized, 40_000) + ","
                + top(others.get(1), 10_000) + "," + top(others.get(2), 5_000) + "]}"));
    }

    @Test
    void 거래가_없는_달은_모두_0이고_목록이_비어_있다() throws Exception {
        fixtures.refund(owner, ledgerId, cash, null, DAY, 2_000);

        assertThat(monthly("month=2026-10").json()).isEqualTo(JSON.readTree(
                "{\"month\":\"2026-10\",\"income\":0,\"expense\":0,\"net\":0,\"topExpenseCategories\":[]}"));
        assertThat(monthly("month=2026-11").json()).as("환불만 있는 달").isEqualTo(JSON.readTree(
                "{\"month\":\"2026-11\",\"income\":0,\"expense\":-2000,\"net\":2000,\"topExpenseCategories\":[]}"));
    }

    /** 형식과 범위는 거래 목록(#15)과 날짜별 합계(#66)의 month와 같은 입력란·코드다. */
    @Test
    void month가_없거나_형식이나_범위가_틀리면_month의_400이다() throws Exception {
        Map<String, String> rejected = Map.of(
                "", "month:REQUIRED",
                "month=2026-1", "month:INVALID_FORMAT",
                "month=2026-13", "month:INVALID_FORMAT",
                "month=", "month:INVALID_FORMAT",
                "month=2026-11&month=2026-12", "month:INVALID_FORMAT",
                "month=1999-12", "month:OUT_OF_RANGE",
                "month=2027-12", "month:OUT_OF_RANGE");
        for (Map.Entry<String, String> query : rejected.entrySet()) {
            monthly(query.getKey()).assertFieldErrors(query.getValue());
        }
        for (String accepted : List.of("month=2000-01", "month=2027-11")) {
            assertThat(monthly(accepted).status()).as(accepted).isEqualTo(200);
        }
    }

    @Test
    void 구성원이_아닌_장부는_month가_틀려도_404이고_토큰이_없으면_401이다() throws Exception {
        User stranger = user();
        UUID strangerLedger = fixtures.personalLedgerId(stranger);
        String path = "/api/v1/ledgers/" + strangerLedger + "/stats/monthly";

        client.get(path + "?month=2026-11").assertProblem(404, "Not Found", "NOT_FOUND");
        client.get(path + "?month=bad").assertProblem(404, "Not Found", "NOT_FOUND");
        ServerClient.anonymous(port).get(path() + "?month=2026-11")
                .assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
    }

    private UUID expenseCategory(String name, UUID parentId) {
        return categoryService.create(owner.getId(), ledgerId,
                new CategoryCommand(name, CategoryKind.EXPENSE, parentId)).getId();
    }

    private static String top(UUID categoryId, long amount) {
        return "{\"categoryId\":\"" + categoryId + "\",\"amount\":" + amount + "}";
    }

    private Reply monthly(String query) throws Exception {
        return client.get(path() + "?" + query);
    }

    private User user() {
        return fixtures.user(UUID.randomUUID().toString().substring(0, 18) + "@example.com");
    }

    private String path() {
        return "/api/v1/ledgers/" + ledgerId + "/stats/monthly";
    }
}
