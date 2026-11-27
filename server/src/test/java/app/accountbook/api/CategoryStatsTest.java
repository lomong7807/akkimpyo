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
 * {@code GET /api/v1/ledgers/{ledgerId}/stats/categories}(#48 응답 계약)의 HTTP 쪽: 응답 모양, month의 오류, 404와 401.
 * 합계 규칙과 달 경계는 {@code MonthlyStatsQueryTest}, 하위 모으기는 {@code CategoryTotalTest}가 본다.
 * 시계는 서울 2026-11-27 12:00이다.
 */
@LedgerApiTest
class CategoryStatsTest {

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
     * 최상위마다 합계, 구분, 펼친 금액이다. 식비는 하위(저녁, 점심)가 큰 순이고 식비에 바로 넣은 금액이 맨 뒤다. 수입, 지출 순이고
     * 환불이 더 큰 카페는 음수로 끝에 있다. 이체, 취소, 삭제, 다른 달은 빠진다.
     */
    @Test
    void 응답은_최상위_카테고리마다_합계와_구분과_하위별_금액이다() throws Exception {
        UUID bank = fixtures.account(owner, ledgerId, "은행", AccountType.BANK, 0, DAY).getId();
        UUID food = category("식비", CategoryKind.EXPENSE, null);
        UUID lunch = category("점심", CategoryKind.EXPENSE, food);
        UUID dinner = category("저녁", CategoryKind.EXPENSE, food);
        UUID cafe = category("카페", CategoryKind.EXPENSE, null);
        UUID salary = category("급여", CategoryKind.INCOME, null);
        UUID uncategorized = categoryService.uncategorized(ledgerId, CategoryKind.EXPENSE).getId();
        fixtures.expense(owner, ledgerId, cash, food, DAY, 1_000);
        fixtures.expense(owner, ledgerId, cash, lunch, DAY, 3_000);
        fixtures.expense(owner, ledgerId, cash, dinner, DAY, 5_000);
        fixtures.expense(owner, ledgerId, cash, cafe, DAY, 1_000);
        fixtures.refund(owner, ledgerId, cash, cafe, DAY, 3_000);
        fixtures.expense(owner, ledgerId, cash, null, DAY, 4_000);
        fixtures.income(owner, ledgerId, bank, salary, DAY, 3_200_000);
        fixtures.transfer(owner, ledgerId, bank, cash, DAY, 50_000);
        fixtures.cancel(owner, fixtures.expense(owner, ledgerId, cash, lunch, DAY, 7_000));
        fixtures.delete(owner, fixtures.expense(owner, ledgerId, cash, dinner, DAY, 9_000));
        fixtures.expense(owner, ledgerId, cash, lunch, LocalDate.of(2026, 12, 1), 1_000);

        Reply reply = categories("month=2026-11");

        assertThat(reply.status()).as(reply.body()).isEqualTo(200);
        assertThat(reply.header("Content-Type")).isEqualTo("application/json");
        assertThat(reply.json()).isEqualTo(JSON.readTree("{\"month\":\"2026-11\",\"categories\":["
                + item(salary, 3_200_000, "INCOME", "") + ","
                + item(food, 9_000, "EXPENSE", child(dinner, 5_000) + "," + child(lunch, 3_000) + ","
                        + child(food, 1_000)) + ","
                + item(uncategorized, 4_000, "EXPENSE", "") + ","
                + item(cafe, -2_000, "EXPENSE", "") + "]}"));
    }

    @Test
    void 거래가_없는_달은_빈_목록이다() throws Exception {
        assertThat(categories("month=2026-10").json())
                .isEqualTo(JSON.readTree("{\"month\":\"2026-10\",\"categories\":[]}"));
    }

    /** 형식과 범위는 월별 통계(#16)의 month와 같은 입력란·코드다. */
    @Test
    void month가_없거나_형식이나_범위가_틀리면_month의_400이다() throws Exception {
        Map<String, String> rejected = Map.of(
                "", "month:REQUIRED",
                "month=2026-13", "month:INVALID_FORMAT",
                "month=", "month:INVALID_FORMAT",
                "month=2026-11&month=2026-12", "month:INVALID_FORMAT",
                "month=1999-12", "month:OUT_OF_RANGE",
                "month=2027-12", "month:OUT_OF_RANGE");
        for (Map.Entry<String, String> query : rejected.entrySet()) {
            categories(query.getKey()).assertFieldErrors(query.getValue());
        }
        for (String accepted : List.of("month=2000-01", "month=2027-11")) {
            assertThat(categories(accepted).status()).as(accepted).isEqualTo(200);
        }
    }

    @Test
    void 구성원이_아닌_장부는_month가_틀려도_404이고_토큰이_없으면_401이다() throws Exception {
        String path = "/api/v1/ledgers/" + fixtures.personalLedgerId(user()) + "/stats/categories";

        client.get(path + "?month=2026-11").assertProblem(404, "Not Found", "NOT_FOUND");
        client.get(path + "?month=bad").assertProblem(404, "Not Found", "NOT_FOUND");
        ServerClient.anonymous(port).get(path() + "?month=2026-11")
                .assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
    }

    private UUID category(String name, CategoryKind kind, UUID parentId) {
        return categoryService.create(owner.getId(), ledgerId, new CategoryCommand(name, kind, parentId)).getId();
    }

    static String item(UUID categoryId, long amount, String kind, String children) {
        return "{\"categoryId\":\"" + categoryId + "\",\"amount\":" + amount + ",\"kind\":\"" + kind
                + "\",\"children\":[" + children + "]}";
    }

    static String child(UUID categoryId, long amount) {
        return "{\"categoryId\":\"" + categoryId + "\",\"amount\":" + amount + ",\"kind\":\"EXPENSE\"}";
    }

    private Reply categories(String query) throws Exception {
        return client.get(path() + "?" + query);
    }

    private User user() {
        return fixtures.user(UUID.randomUUID().toString().substring(0, 18) + "@example.com");
    }

    private String path() {
        return "/api/v1/ledgers/" + ledgerId + "/stats/categories";
    }
}
