package app.accountbook.api;

import static app.accountbook.api.AccountCreateTest.NOW;
import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.account.AccountType;
import app.accountbook.api.ServerClient.Reply;
import app.accountbook.ledger.LedgerRole;
import app.accountbook.support.Fixtures;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.user.User;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.JsonNode;

/**
 * {@code PUT /api/v1/ledgers/{ledgerId}/accounts/{accountId}/visibility}(#43, F-506, F-507). 본문은
 * {@code {"hidden": true|false}}이고 응답은 목록의 항목과 같다. version은 없다(계좌 고치기와 같다).
 */
@LedgerApiTest
class AccountHideTest {

    private static final LocalDate OPENING = LocalDate.of(2026, 11, 1);
    private static final LocalDate DAY = LocalDate.of(2026, 11, 18);

    @LocalServerPort int port;
    @Autowired StoppedClock clock;
    @Autowired Fixtures fixtures;
    @Autowired JdbcTemplate jdbc;

    private User owner;
    private UUID ledgerId;
    private UUID bank;
    private ServerClient client;

    @BeforeEach
    void setUp() {
        clock.stopAt(NOW);
        owner = user();
        ledgerId = fixtures.personalLedgerId(owner);
        bank = fixtures.account(owner, ledgerId, "월급통장", AccountType.BANK, 100_000, OPENING).getId();
        client = ServerClient.signedIn(port, owner.getId(), NOW);
    }

    /** HTTP 테스트는 롤백되지 않는다. 거래 수를 DB 전체로 세는 테스트(TransactionServiceTest 등)가 있어 만든 거래를 지운다. */
    @AfterEach
    void removeTransactions() {
        jdbc.update("delete from change_log where ledger_id = ?", ledgerId);
        jdbc.update("delete from transaction where ledger_id = ?", ledgerId);
    }

    @Test
    void 숨기면_200이고_본문은_목록의_항목과_같으며_잔액은_그대로다() throws Exception {
        fixtures.expense(owner, ledgerId, bank, null, DAY, 12_000);

        Reply hidden = visibility(bank, "{\"hidden\":true}");

        assertThat(hidden.status()).as(hidden.body()).isEqualTo(200);
        assertThat(hidden.header("Content-Type")).isEqualTo("application/json");
        JsonNode account = hidden.json();
        assertThat(account.propertyNames())
                .containsExactly("id", "name", "type", "balance", "openingBalance", "openingDate", "hidden");
        assertThat(account.get("id").asString()).isEqualTo(bank.toString());
        assertThat(account.get("hidden").isBoolean()).isTrue();
        assertThat(account.get("hidden").asBoolean()).isTrue();
        assertThat(account.get("balance").asLong()).as("숨겨도 잔액에 거래가 든다").isEqualTo(88_000);
        assertThat(client.get(path()).json().get("items").get(0)).as("목록은 숨긴 계좌도 담는다").isEqualTo(account);
        assertThat(stored(bank)).isTrue();

        Reply shown = visibility(bank, "{\"hidden\":false}");

        assertThat(shown.status()).as(shown.body()).isEqualTo(200);
        assertThat(shown.json().get("hidden").asBoolean()).isFalse();
        assertThat(stored(bank)).isFalse();
    }

    @Test
    void 이미_그_상태여도_200이다() throws Exception {
        assertThat(visibility(bank, "{\"hidden\":false}").json().get("hidden").asBoolean()).isFalse();
        assertThat(visibility(bank, "{\"hidden\":true}").status()).isEqualTo(200);

        Reply again = visibility(bank, "{\"hidden\":true}");

        assertThat(again.status()).as(again.body()).isEqualTo(200);
        assertThat(again.json().get("hidden").asBoolean()).isTrue();
        assertThat(stored(bank)).isTrue();
    }

    @ParameterizedTest(name = "{0} → {1}")
    @CsvSource(delimiterString = "|", textBlock = """
            {}                          | hidden:REQUIRED
            {"hidden":null}             | hidden:REQUIRED
            {"hidden":"true"}           | hidden:INVALID_FORMAT
            {"hidden":1}                | hidden:INVALID_FORMAT
            {"hidden":[true]}           | hidden:INVALID_FORMAT
            []                          | :INVALID_FORMAT
            """)
    void 본문이_틀리면_400이고_바꾸지_않는다(String body, String expected) throws Exception {
        visibility(bank, body).assertFieldErrors(expected);

        assertThat(stored(bank)).isFalse();
    }

    @Test
    void 숨긴_계좌로는_거래를_만들_수_없다() throws Exception {
        visibility(bank, "{\"hidden\":true}");

        client.postJson("/api/v1/ledgers/" + ledgerId + "/transactions", "{\"id\":\"" + UUID.randomUUID()
                        + "\",\"type\":\"EXPENSE\",\"occurredOn\":\"2026-11-18\",\"accountId\":\"" + bank
                        + "\",\"amount\":1000}")
                .assertFieldErrors("accountId:NOT_ALLOWED");
    }

    /** 내가 구성원인 다른 장부의 계좌, 남의 계좌, 없는 계좌, 형식이 틀린 id는 본문이 틀려도 같은 404이고 바꾸지 않는다. */
    @Test
    void 경로의_장부의_계좌가_아니면_본문이_틀려도_같은_404다() throws Exception {
        User other = user();
        UUID shared = fixtures.personalLedgerId(other);
        fixtures.addMember(shared, owner, LedgerRole.MEMBER);
        UUID sharedCash = fixtures.account(other, shared, "같이쓰는현금", AccountType.CASH, 0, OPENING).getId();
        User stranger = user();
        UUID strangerCash = fixtures.account(stranger, fixtures.personalLedgerId(stranger), "남의현금",
                AccountType.CASH, 0, OPENING).getId();
        Reply missing = visibility(UUID.randomUUID(), "{\"hidden\":true}");

        for (Object target : List.of(sharedCash, strangerCash, "x")) {
            for (String body : List.of("{\"hidden\":true}", "{}", "{\"hidden\":1}")) {
                Reply reply = visibility(target, body).assertProblem(404, "Not Found", "NOT_FOUND");
                assertThat(withoutRequestId(reply)).as(target + " " + body).isEqualTo(withoutRequestId(missing));
            }
        }
        assertThat(List.of(stored(sharedCash), stored(strangerCash))).containsExactly(false, false);
        // 대조: 그 계좌의 장부 경로로는 숨겨진다.
        assertThat(client.send("PUT", "/api/v1/ledgers/" + shared + "/accounts/" + sharedCash + "/visibility",
                "{\"hidden\":true}", "Content-Type", "application/json").status()).isEqualTo(200);
    }

    /** 401 → 415 → 404다(고치기와 같다). 응답할 수 없는 {@code Accept}와 JSON이 아닌 본문은 바꾸기 전에 거절한다. */
    @Test
    void 인증과_Content_Type이_구성원_확인보다_먼저이고_받을_수_없는_요청은_바꾸기_전에_거절한다() throws Exception {
        String path = path() + "/" + bank + "/visibility";
        String hide = "{\"hidden\":true}";
        ServerClient outsider = ServerClient.signedIn(port, user().getId(), NOW);

        ServerClient.anonymous(port).send("PUT", path, hide, "Content-Type", "application/json")
                .assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
        outsider.send("PUT", path, hide, "Content-Type", "text/plain")
                .assertProblem(415, "Unsupported Media Type", "UNSUPPORTED_MEDIA_TYPE");
        outsider.send("PUT", path, "{", "Content-Type", "application/json")
                .assertProblem(404, "Not Found", "NOT_FOUND");
        outsider.send("PUT", path, "{}", "Content-Type", "application/json")
                .assertProblem(404, "Not Found", "NOT_FOUND");
        client.send("PUT", path, hide, "Content-Type", "application/json", "Accept", "text/html")
                .assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
        client.send("PUT", path, hide).assertProblem(415, "Unsupported Media Type", "UNSUPPORTED_MEDIA_TYPE");
        visibility(bank, "{").assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
        visibility(bank, hide + " {}").assertProblem(400, "Bad Request", "MALFORMED_REQUEST");

        assertThat(stored(bank)).isFalse();
    }

    // ---------------------------------------------------------------- 도우미

    private Reply visibility(Object accountId, String json) throws Exception {
        return client.send("PUT", path() + "/" + accountId + "/visibility", json, "Content-Type", "application/json",
                "Accept", "application/json");
    }

    private Boolean stored(UUID accountId) {
        return jdbc.queryForObject("select hidden from account where id = ?", Boolean.class, accountId);
    }

    private User user() {
        return fixtures.user(UUID.randomUUID().toString().substring(0, 18) + "@example.com");
    }

    private String path() {
        return "/api/v1/ledgers/" + ledgerId + "/accounts";
    }

    private static String withoutRequestId(Reply reply) {
        return reply.body().replace(reply.header("X-Request-Id"), "");
    }
}
