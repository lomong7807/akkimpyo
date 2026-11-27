package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.account.AccountType;
import app.accountbook.api.ServerClient.Reply;
import app.accountbook.category.CategoryCommand;
import app.accountbook.category.CategoryKind;
import app.accountbook.category.CategoryService;
import app.accountbook.support.Fixtures;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.transaction.TransactionCommand.Entry;
import app.accountbook.transaction.TransactionService;
import app.accountbook.transaction.TransactionType;
import app.accountbook.user.User;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
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
import tools.jackson.databind.json.JsonMapper;

/**
 * {@code GET /api/v1/ledgers/{ledgerId}/category-suggestions}(#61 응답 계약)의 HTTP 쪽: 응답 모양과 거래를 바꾸지 않음,
 * payee의 오류, 404와 401. 고르는 규칙은 {@code CategorySuggestionQueryTest}가 본다.
 */
@LedgerApiTest
class CategorySuggestionTest {

    private static final Instant NOW = Instant.parse("2026-11-27T03:00:00Z");
    private static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    private static final JsonMapper JSON = new JsonMapper();

    @LocalServerPort int port;
    @Autowired StoppedClock clock;
    @Autowired Fixtures fixtures;
    @Autowired CategoryService categoryService;
    @Autowired TransactionService transactionService;
    @Autowired JdbcTemplate jdbc;

    private User owner;
    private UUID ledgerId;
    private UUID cash;
    private UUID food;
    private ServerClient client;

    @BeforeEach
    void setUp() {
        clock.stopAt(NOW);
        owner = user();
        ledgerId = fixtures.personalLedgerId(owner);
        cash = fixtures.account(owner, ledgerId, "현금", AccountType.CASH, 0, DAY).getId();
        food = categoryService.create(owner.getId(), ledgerId, new CategoryCommand("식비", CategoryKind.EXPENSE, null))
                .getId();
        client = ServerClient.signedIn(port, owner.getId(), NOW);
    }

    /** HTTP 테스트는 롤백되지 않는다. 거래를 만든 장부를 지운다. */
    @AfterEach
    void removeTransactions() {
        jdbc.update("delete from change_log where ledger_id = ?", ledgerId);
        jdbc.update("delete from transaction where ledger_id = ?", ledgerId);
    }

    @Test
    void 응답은_categoryId_하나이고_제안이_없으면_null이며_거래를_바꾸지_않는다() throws Exception {
        expense("Star Bucks");
        List<List<Map<String, Object>>> before = rows();

        Reply reply = suggest("payee=" + encode("starbucks"));

        assertThat(reply.status()).as(reply.body()).isEqualTo(200);
        assertThat(reply.header("Content-Type")).isEqualTo("application/json");
        assertThat(reply.json()).isEqualTo(JSON.readTree("{\"categoryId\":\"" + food + "\"}"));
        for (String none : List.of("payee=" + encode("없는 가게"), "payee=", "payee=" + encode(" 　"), "")) {
            assertThat(suggest(none).json()).as(none).isEqualTo(JSON.readTree("{\"categoryId\":null}"));
        }
        assertThat(rows()).as("제안만 하고 저장된 거래를 바꾸지 않는다(P-219)").isEqualTo(before);
    }

    /** 두 번 보내면 스프링이 쉼표로 이어 붙여 다른 가맹점이 되므로 형식 오류로 막는다. */
    @Test
    void payee가_100자를_넘거나_쓸_수_없는_글자가_있거나_두_번_오면_payee의_400이다() throws Exception {
        Map<String, String> rejected = Map.of(
                "payee=" + encode("가".repeat(101)), "payee:TOO_LONG",
                "payee=" + encode("올래​국수"), "payee:INVALID_FORMAT",
                "payee=a&payee=b", "payee:INVALID_FORMAT");
        for (Map.Entry<String, String> query : rejected.entrySet()) {
            suggest(query.getKey()).assertFieldErrors(query.getValue());
        }
        assertThat(suggest("payee=" + encode("가".repeat(100))).status()).isEqualTo(200);
    }

    @Test
    void 구성원이_아닌_장부는_payee가_틀려도_404이고_토큰이_없으면_401이다() throws Exception {
        String path = "/api/v1/ledgers/" + fixtures.personalLedgerId(user()) + "/category-suggestions";

        client.get(path + "?payee=a").assertProblem(404, "Not Found", "NOT_FOUND");
        client.get(path + "?payee=" + "x".repeat(101)).assertProblem(404, "Not Found", "NOT_FOUND");
        ServerClient.anonymous(port).get(path() + "?payee=a").assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
    }

    private void expense(String payee) {
        transactionService.create(owner.getId(), ledgerId, new Entry(UUID.randomUUID(), TransactionType.EXPENSE, DAY,
                null, cash, food, 1_000, false, payee, null, null), "test-device");
    }

    private List<List<Map<String, Object>>> rows() {
        return List.of("transaction", "transaction_line", "change_log").stream()
                .map(table -> jdbc.queryForList("select * from " + table + " where ledger_id = ? order by id", ledgerId))
                .toList();
    }

    private Reply suggest(String query) throws Exception {
        return client.get(path() + "?" + query);
    }

    private static String encode(String text) {
        return URLEncoder.encode(text, StandardCharsets.UTF_8);
    }

    private User user() {
        return fixtures.user(UUID.randomUUID().toString().substring(0, 18) + "@example.com");
    }

    private String path() {
        return "/api/v1/ledgers/" + ledgerId + "/category-suggestions";
    }
}
