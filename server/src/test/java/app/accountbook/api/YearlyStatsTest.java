package app.accountbook.api;

import static app.accountbook.api.CategoryStatsTest.child;
import static app.accountbook.api.CategoryStatsTest.item;
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
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.json.JsonMapper;

/**
 * {@code GET /api/v1/ledgers/{ledgerId}/stats/yearly}(#48 응답 계약)의 HTTP 쪽: 응답 모양, year의 오류, 404와 401.
 * 합계 규칙과 해 경계는 {@code YearlyStatsQueryTest}가 본다. 시계는 서울 2026-11-27 12:00이다.
 */
@LedgerApiTest
class YearlyStatsTest {

    private static final Instant NOW = Instant.parse("2026-11-27T03:00:00Z");
    private static final LocalDate OPENING = LocalDate.of(2024, 1, 1);
    private static final JsonMapper JSON = new JsonMapper();

    @LocalServerPort int port;
    @Autowired StoppedClock clock;
    @Autowired Fixtures fixtures;
    @Autowired CategoryService categoryService;
    @Autowired JdbcTemplate jdbc;

    private User owner;
    private UUID ledgerId;
    private ServerClient client;

    @BeforeEach
    void setUp() {
        clock.stopAt(NOW);
        owner = fixtures.user(UUID.randomUUID().toString().substring(0, 18) + "@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
        client = ServerClient.signedIn(port, owner.getId(), NOW);
    }

    /** HTTP 테스트는 롤백되지 않는다. */
    @AfterEach
    void removeTransactions() {
        jdbc.update("delete from change_log where ledger_id = ?", ledgerId);
        jdbc.update("delete from transaction where ledger_id = ?", ledgerId);
    }

    /** 1월~12월 12개(빈 달은 0), 연 합계, 그해의 카테고리(하위별 금액 포함)다. 앞뒤 해와 이체는 빠진다. */
    @Test
    void 응답은_12달과_연_합계와_그해의_카테고리다() throws Exception {
        UUID cash = fixtures.account(owner, ledgerId, "현금", AccountType.CASH, 0, OPENING).getId();
        UUID bank = fixtures.account(owner, ledgerId, "은행", AccountType.BANK, 0, OPENING).getId();
        UUID food = category("식비", CategoryKind.EXPENSE, null);
        UUID lunch = category("점심", CategoryKind.EXPENSE, food);
        UUID salary = category("급여", CategoryKind.INCOME, null);
        fixtures.income(owner, ledgerId, bank, salary, LocalDate.of(2025, 1, 1), 3_000_000);
        fixtures.expense(owner, ledgerId, cash, lunch, LocalDate.of(2025, 2, 28), 8_000);
        fixtures.expense(owner, ledgerId, cash, food, LocalDate.of(2025, 12, 31), 45_000);
        fixtures.transfer(owner, ledgerId, bank, cash, LocalDate.of(2025, 5, 15), 50_000);
        fixtures.expense(owner, ledgerId, cash, food, LocalDate.of(2024, 12, 31), 1);
        fixtures.expense(owner, ledgerId, cash, food, LocalDate.of(2026, 1, 1), 20);

        Reply reply = yearly("year=2025");

        assertThat(reply.status()).as(reply.body()).isEqualTo(200);
        assertThat(reply.header("Content-Type")).isEqualTo("application/json");
        Map<Integer, String> filled = Map.of(1, month(1, 3_000_000, 0), 2, month(2, 0, 8_000), 12, month(12, 0, 45_000));
        String months = IntStream.rangeClosed(1, 12).mapToObj(n -> filled.getOrDefault(n, month(n, 0, 0)))
                .collect(Collectors.joining(","));
        assertThat(reply.json()).isEqualTo(JSON.readTree("{\"year\":2025,\"months\":[" + months + "],"
                + "\"income\":3000000,\"expense\":53000,\"net\":2947000,\"categories\":["
                + item(salary, 3_000_000, "INCOME", "") + ","
                + item(food, 53_000, "EXPENSE", child(lunch, 8_000) + "," + child(food, 45_000)) + "]}"));
    }

    /** 범위는 연 단위 통계 서비스(#10)와 같다: 2000년부터 오늘(서울 2026-11-27)로부터 1년 뒤의 날이 속한 해까지. */
    @Test
    void year가_없거나_형식이나_범위가_틀리면_year의_400이다() throws Exception {
        Map<String, String> rejected = Map.of(
                "", "year:REQUIRED",
                "year=", "year:INVALID_FORMAT",
                "year=25", "year:INVALID_FORMAT",
                "year=02025", "year:INVALID_FORMAT",
                "year=2025-01", "year:INVALID_FORMAT",
                "year=%2B2025", "year:INVALID_FORMAT",
                "year=2025&year=2026", "year:INVALID_FORMAT",
                "year=1999", "year:OUT_OF_RANGE",
                "year=2028", "year:OUT_OF_RANGE");
        for (Map.Entry<String, String> query : rejected.entrySet()) {
            yearly(query.getKey()).assertFieldErrors(query.getValue());
        }
        for (String accepted : List.of("year=2000", "year=2027")) {
            Reply reply = yearly(accepted);
            assertThat(reply.status()).as(accepted).isEqualTo(200);
            assertThat(reply.json().get("months").size()).isEqualTo(12);
        }
    }

    @Test
    void 구성원이_아닌_장부는_year가_틀려도_404이고_토큰이_없으면_401이다() throws Exception {
        User stranger = fixtures.user(UUID.randomUUID().toString().substring(0, 18) + "@example.com");
        String path = "/api/v1/ledgers/" + fixtures.personalLedgerId(stranger) + "/stats/yearly";

        client.get(path + "?year=2025").assertProblem(404, "Not Found", "NOT_FOUND");
        client.get(path + "?year=bad").assertProblem(404, "Not Found", "NOT_FOUND");
        ServerClient.anonymous(port).get("/api/v1/ledgers/" + ledgerId + "/stats/yearly?year=2025")
                .assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
    }

    private UUID category(String name, CategoryKind kind, UUID parentId) {
        return categoryService.create(owner.getId(), ledgerId, new CategoryCommand(name, kind, parentId)).getId();
    }

    private static String month(int month, long income, long expense) {
        return "{\"month\":\"2025-%02d\",\"income\":%d,\"expense\":%d,\"net\":%d}"
                .formatted(month, income, expense, income - expense);
    }

    private Reply yearly(String query) throws Exception {
        return client.get("/api/v1/ledgers/" + ledgerId + "/stats/yearly?" + query);
    }
}
