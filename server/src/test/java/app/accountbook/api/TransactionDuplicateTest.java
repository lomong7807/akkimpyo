package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.account.AccountType;
import app.accountbook.api.ServerClient.Reply;
import app.accountbook.support.Fixtures;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.user.User;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
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
 * {@code GET /api/v1/ledgers/{ledgerId}/transactions/duplicates}(#59 응답 계약)의 HTTP 쪽: 응답 모양, 쿼리 값의 오류, 404와 401.
 * 비교 규칙은 {@code TransactionDuplicateQueryTest}가 본다. 시계는 서울 2026-11-27 12:00이다.
 */
@LedgerApiTest
class TransactionDuplicateTest {

    private static final Instant NOW = Instant.parse("2026-11-27T03:00:00Z");
    private static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    private static final String FOUND = "occurredOn=2026-11-18&amount=12000&payee=" + encoded(" 올래 국수 ");
    private static final JsonMapper JSON = new JsonMapper();

    @LocalServerPort int port;
    @Autowired StoppedClock clock;
    @Autowired Fixtures fixtures;
    @Autowired JdbcTemplate jdbc;

    private UUID ledgerId;
    private UUID cash;
    private ServerClient client;
    /** HTTP 테스트는 롤백되지 않는다. 거래를 만든 장부를 적어 두고 끝나면 지운다. */
    private final List<UUID> ledgers = new ArrayList<>();

    @BeforeEach
    void setUp() {
        clock.stopAt(NOW);
        User owner = user();
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

    @Test
    void 응답은_items이고_거래는_상세_조회와_같은_모양이다() throws Exception {
        UUID id = UUID.randomUUID();
        assertThat(client.postJson(transactions(), "{\"id\":\"" + id + "\",\"type\":\"EXPENSE\",\"occurredOn\":"
                + "\"2026-11-18\",\"accountId\":\"" + cash + "\",\"amount\":12000,\"payee\":\"올래국수\"}").status())
                .isEqualTo(201);

        Reply reply = duplicates(FOUND);

        assertThat(reply.status()).as(reply.body()).isEqualTo(200);
        assertThat(reply.header("Content-Type")).isEqualTo("application/json");
        assertThat(reply.json().propertyNames()).containsExactly("items");
        assertThat(reply.json().get("items")).hasSize(1);
        assertThat(reply.json().get("items").get(0)).isEqualTo(client.get(transactions() + "/" + id).json());
        assertThat(duplicates(FOUND + "&exclude=" + id.toString().toUpperCase(Locale.ROOT)).json())
                .isEqualTo(JSON.readTree("{\"items\":[]}"));
        assertThat(duplicates("occurredOn=2026-11-18&amount=12000").json()).as("가맹점 없음")
                .isEqualTo(JSON.readTree("{\"items\":[]}"));
    }

    @Test
    void 쿼리_값이_틀리면_입력란마다_400이다() throws Exception {
        String day = "occurredOn=2026-11-18";
        Map<String, List<String>> rejected = Map.of(
                "payee=a", List.of("occurredOn:REQUIRED", "amount:REQUIRED"),
                "occurredOn=2026-11-31&amount=x&exclude=1-2-3-4-5",
                List.of("occurredOn:INVALID_FORMAT", "amount:INVALID_FORMAT", "exclude:INVALID_FORMAT"),
                "occurredOn=&amount=-1&exclude=", List.of("occurredOn:INVALID_FORMAT", "amount:INVALID_FORMAT",
                        "exclude:INVALID_FORMAT"),
                day + "&" + day + "&amount=" + encoded("1,000") + "&payee=a&payee=b",
                List.of("occurredOn:INVALID_FORMAT", "amount:INVALID_FORMAT", "payee:INVALID_FORMAT"),
                day + "&amount=12000.0", List.of("amount:INVALID_FORMAT"),
                day + "&amount=0&payee=a", List.of("amount:OUT_OF_RANGE"),
                day + "&amount=12000&payee=" + "x".repeat(101), List.of("payee:TOO_LONG"),
                day + "&amount=12000&payee=" + encoded("올래​국수"), List.of("payee:INVALID_FORMAT"));
        for (Map.Entry<String, List<String>> query : rejected.entrySet()) {
            duplicates(query.getKey()).assertFieldErrors(query.getValue().toArray(String[]::new));
        }
    }

    @Test
    void 구성원이_아닌_장부는_쿼리가_틀려도_404이고_토큰이_없으면_401이다() throws Exception {
        String path = "/api/v1/ledgers/" + fixtures.personalLedgerId(user()) + "/transactions/duplicates";

        client.get(path + "?" + FOUND).assertProblem(404, "Not Found", "NOT_FOUND");
        client.get(path + "?amount=x").assertProblem(404, "Not Found", "NOT_FOUND");
        ServerClient.anonymous(port).get(transactions() + "/duplicates?" + FOUND)
                .assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
    }

    private Reply duplicates(String query) throws Exception {
        return client.get(transactions() + "/duplicates?" + query);
    }

    private User user() {
        return fixtures.user(UUID.randomUUID().toString().substring(0, 18) + "@example.com");
    }

    private String transactions() {
        return "/api/v1/ledgers/" + ledgerId + "/transactions";
    }

    private static String encoded(String text) {
        return URLEncoder.encode(text, StandardCharsets.UTF_8);
    }
}
