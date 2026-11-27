package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.account.AccountType;
import app.accountbook.api.ServerClient.Reply;
import app.accountbook.support.Fixtures;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.user.User;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * {@code GET /api/v1/ledgers/{ledgerId}/transactions/search}(#64 응답 계약)의 HTTP 쪽: 응답 모양, 검색어 맞추기, cursor,
 * 쿼리 값의 오류, 404와 401. 찾는 규칙은 {@code TransactionSearchQueryTest}가 본다. 시계는 서울 2026-11-27 12:00이다.
 */
@LedgerApiTest
class TransactionSearchTest {

    private static final Instant NOW = Instant.parse("2026-11-27T03:00:00Z");
    private static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    private static final JsonMapper JSON = new JsonMapper();

    @LocalServerPort int port;
    @Autowired StoppedClock clock;
    @Autowired Fixtures fixtures;
    @Autowired JdbcTemplate jdbc;

    private User owner;
    private UUID ledgerId;
    private UUID cash;
    private ServerClient client;

    @BeforeEach
    void setUp() {
        clock.stopAt(NOW);
        owner = user();
        ledgerId = fixtures.personalLedgerId(owner);
        cash = fixtures.account(owner, ledgerId, "현금", AccountType.CASH, 0, DAY).getId();
        client = ServerClient.signedIn(port, owner.getId(), NOW);
    }

    /** HTTP 테스트는 롤백되지 않는다. 만든 거래를 지운다. */
    @AfterEach
    void removeTransactions() {
        jdbc.update("delete from change_log where ledger_id = ?", ledgerId);
        jdbc.update("delete from transaction where ledger_id = ?", ledgerId);
    }

    @Test
    void 응답은_items_nextCursor_totals이고_거래는_상세와_같은_모양이며_검색어는_저장처럼_맞춘다() throws Exception {
        UUID id = UUID.randomUUID();
        assertThat(client.postJson(path(), "{\"id\":\"" + id + "\",\"type\":\"EXPENSE\",\"occurredOn\":\"2026-11-18\","
                + "\"accountId\":\"" + cash + "\",\"amount\":12000,\"payee\":\"올래국수\"}").status()).isEqualTo(201);
        fixtures.income(owner, ledgerId, cash, null, DAY, 3_000);

        Reply reply = search("q=" + encoded(" " + Normalizer.normalize("올래", Normalizer.Form.NFD) + "　"));

        assertThat(reply.status()).as(reply.body()).isEqualTo(200);
        assertThat(reply.header("Content-Type")).isEqualTo("application/json");
        JsonNode page = reply.json();
        assertThat(page.propertyNames()).containsExactlyInAnyOrder("items", "nextCursor", "totals");
        assertThat(page.get("items")).hasSize(1);
        assertThat(page.get("items").get(0)).isEqualTo(client.get(path() + "/" + id).json());
        assertThat(page.get("nextCursor").isNull()).isTrue();
        assertThat(page.get("totals")).isEqualTo(JSON.readTree("{\"count\":1,\"income\":0,\"expense\":12000}"));
        assertThat(search("q=" + encoded("  ") + "&type=INCOME").json().get("totals")).as("빈 검색어는 없는 것이다")
                .isEqualTo(JSON.readTree("{\"count\":1,\"income\":3000,\"expense\":0}"));
    }

    /** 다음 쪽은 같은 검색어·기간·필터에서 받은 cursor로만 이어진다. 거래 목록(#15)의 cursor도 받지 않는다. */
    @Test
    void 결과가_51건이면_50건과_cursor가_오고_cursor는_같은_검색에서만_받는다() throws Exception {
        for (int i = 0; i < 51; i++) {
            fixtures.expense(owner, ledgerId, cash, null, DAY.minusDays(i % 3), 777);
        }
        String query = "q=777&from=2026-11-01";
        JsonNode first = search(query).json();
        String cursor = "&cursor=" + first.get("nextCursor").asString();
        JsonNode second = search(query + cursor).json();

        assertThat(first.get("items")).hasSize(50);
        assertThat(first.get("totals")).isEqualTo(JSON.readTree("{\"count\":51,\"income\":0,\"expense\":39627}"));
        assertThat(second.get("items")).hasSize(1);
        assertThat(second.get("nextCursor").isNull()).isTrue();
        assertThat(second.get("totals").isNull()).isTrue();
        String listCursor = client.get(path() + "?limit=1").json().get("nextCursor").asString();
        for (String other : List.of("q=7777&from=2026-11-01" + cursor, "q=777" + cursor, query + "&to=2026-11-30"
                + cursor, query + "&type=EXPENSE" + cursor, query + "&cursor=" + listCursor, query + cursor + "A")) {
            search(other).assertFieldErrors("cursor:INVALID_FORMAT");
        }
    }

    @Test
    void 쿼리_값이_틀리면_입력란마다_400이다() throws Exception {
        Map<String, List<String>> rejected = Map.ofEntries(
                Map.entry("", List.of("q:REQUIRED")),
                Map.entry("q=" + encoded(" 　 "), List.of("q:REQUIRED")),
                Map.entry("q=" + encoded("가".repeat(101)) + "&cursor=x", List.of("q:TOO_LONG")),
                Map.entry("q=" + encoded("올래​국수"), List.of("q:INVALID_FORMAT")),
                Map.entry("q=a&from=2026-02-29&to=&type=x",
                        List.of("from:INVALID_FORMAT", "to:INVALID_FORMAT", "type:INVALID_FORMAT")),
                Map.entry("from=0000-12-31&to=10000-01-01", List.of("from:OUT_OF_RANGE", "to:INVALID_FORMAT")),
                Map.entry("from=2026-11-30&to=2026-11-01", List.of("to:NOT_ALLOWED")),
                Map.entry("q=a&accountId=" + UUID.randomUUID(), List.of("accountId:NOT_FOUND")),
                Map.entry("q=a&status=PENDING", List.of("status:INVALID_FORMAT")),
                Map.entry("q=a&cursor=abc", List.of("cursor:INVALID_FORMAT")));
        for (Map.Entry<String, List<String>> query : rejected.entrySet()) {
            search(query.getKey()).assertFieldErrors(query.getValue().toArray(String[]::new));
        }
        assertThat(search("q=" + encoded(" " + "가".repeat(100) + " ")).status()).isEqualTo(200);
        assertThat(search("from=0001-01-01&to=9999-12-31").status()).isEqualTo(200);
    }

    @Test
    void 구성원이_아닌_장부는_쿼리가_틀려도_404이고_토큰이_없으면_401이다() throws Exception {
        String stranger = "/api/v1/ledgers/" + fixtures.personalLedgerId(user()) + "/transactions/search";

        client.get(stranger + "?q=a").assertProblem(404, "Not Found", "NOT_FOUND");
        client.get(stranger).assertProblem(404, "Not Found", "NOT_FOUND");
        client.get(stranger + "?from=bad&cursor=bad").assertProblem(404, "Not Found", "NOT_FOUND");
        ServerClient.anonymous(port).get(path() + "/search?q=a").assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
    }

    private Reply search(String query) throws Exception {
        return client.get(path() + "/search?" + query);
    }

    private User user() {
        return fixtures.user(UUID.randomUUID().toString().substring(0, 18) + "@example.com");
    }

    private String path() {
        return "/api/v1/ledgers/" + ledgerId + "/transactions";
    }

    private static String encoded(String text) {
        return URLEncoder.encode(text, StandardCharsets.UTF_8);
    }
}
