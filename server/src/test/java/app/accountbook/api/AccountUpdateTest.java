package app.accountbook.api;

import static app.accountbook.api.AccountCreateTest.NOW;
import static app.accountbook.api.AccountCreateTest.body;
import static app.accountbook.api.AccountCreateTest.json;
import static app.accountbook.api.AccountCreateTest.quoted;
import static app.accountbook.api.AccountCreateTest.valid;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;

import app.accountbook.account.AccountRepository;
import app.accountbook.account.AccountType;
import app.accountbook.api.ServerClient.Reply;
import app.accountbook.ledger.LedgerRole;
import app.accountbook.support.Fixtures;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.user.User;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.JsonNode;

/**
 * {@code PUT /api/v1/ledgers/{ledgerId}/accounts/{accountId}}(#33, F-503). 본문과 검증은 추가({@link AccountCreateTest})와
 * 같고 시계도 같다(서울은 2026-11-28 00:30, 기준일의 끝은 2027-11-28). version은 없다(P-217).
 */
@LedgerApiTest
class AccountUpdateTest {

    private static final LocalDate OPENING = LocalDate.of(2026, 11, 1);
    /** {@link AccountCreateTest#valid()}와 같은 값이다. 그대로 보내면 바뀌는 것이 없다. */
    private static final String UNCHANGED = "생활비 BANK 0 2026-11-01";

    @LocalServerPort int port;
    @Autowired StoppedClock clock;
    @Autowired Fixtures fixtures;
    @Autowired AccountRepository accountRepository;
    @Autowired JdbcTemplate jdbc;

    private User owner;
    private UUID ledgerId;
    private UUID living;
    private ServerClient client;

    @BeforeEach
    void setUp() {
        clock.stopAt(NOW);
        owner = user();
        ledgerId = fixtures.personalLedgerId(owner);
        living = fixtures.account(owner, ledgerId, "생활비", AccountType.BANK, 0, OPENING).getId();
        client = ServerClient.signedIn(port, owner.getId(), NOW);
    }

    /** HTTP 테스트는 롤백되지 않는다. 거래 수를 DB 전체로 세는 테스트(TransactionServiceTest 등)가 있어 만든 거래를 지운다. */
    @AfterEach
    void removeTransactions() {
        jdbc.update("delete from change_log where ledger_id = ?", ledgerId);
        jdbc.update("delete from transaction where ledger_id = ?", ledgerId);
    }

    @Test
    void 고치면_200이고_본문은_목록의_항목과_같으며_종류도_바뀐다() throws Exception {
        Reply updated = put(living, body("\"  신한카드　\"", "\"CARD\"", "-350000", "\"2026-10-31\""));

        assertThat(updated.status()).as(updated.body()).isEqualTo(200);
        assertThat(updated.header("Content-Type")).isEqualTo("application/json");
        JsonNode account = updated.json();
        assertThat(account.propertyNames()).containsExactly("id", "name", "type", "balance", "openingBalance", "openingDate");
        assertThat(List.of(account.get("id").asString(), account.get("name").asString(),
                account.get("type").asString(), account.get("openingDate").asString()))
                .containsExactly(living.toString(), "신한카드", "CARD", "2026-10-31");
        assertThat(account.get("balance").isIntegralNumber()).isTrue();
        assertThat(account.get("balance").asLong()).as("부호를 바꾸지 않는다").isEqualTo(-350_000);
        assertThat(account.get("openingBalance").isIntegralNumber()).isTrue();
        assertThat(account.get("openingBalance").asLong()).isEqualTo(-350_000);
        assertThat(client.get(path()).json().get("items").get(0)).isEqualTo(account);
        assertThat(stored(living)).isEqualTo("신한카드 CARD -350000 2026-10-31");
    }

    /** 잔액은 바꾼 시작 잔액에 바꾼 기준일(포함) 이후 거래를 더한 값이다(P-206). 기준일을 달의 경계 앞뒤로 옮긴다. */
    @Test
    void 시작_잔액이나_기준일을_바꾸면_잔액을_다시_구한다() throws Exception {
        UUID bank = fixtures.account(owner, ledgerId, "월급통장", AccountType.BANK, 100_000,
                LocalDate.of(2026, 10, 1)).getId();
        fixtures.expense(owner, ledgerId, bank, null, LocalDate.of(2026, 10, 31), 3_000);
        fixtures.expense(owner, ledgerId, bank, null, LocalDate.of(2026, 11, 1), 5_000);

        assertThat(balanceAfter(bank, "100000", "2026-11-01")).as("11-01은 들고 10-31은 빠진다").isEqualTo(95_000);
        assertThat(balanceAfter(bank, "50000", "2026-11-01")).as("시작 잔액만 바꾼다").isEqualTo(45_000);
        assertThat(balanceAfter(bank, "50000", "2026-11-02")).as("둘 다 빠진다").isEqualTo(50_000);
        assertThat(balanceAfter(bank, "50000", "2026-10-31")).as("둘 다 든다").isEqualTo(42_000);
    }

    @ParameterizedTest(name = "{0} = {1} → {2}")
    @MethodSource("app.accountbook.api.AccountCreateTest#oneWrongField")
    void 한_칸이_틀리면_추가와_같은_이유로_400이고_바꾸지_않는다(String field, String value, String expected)
            throws Exception {
        Map<String, String> fields = valid();
        fields.put("name", "\"바꾼이름\"");
        fields.put(field, value);

        put(living, json(fields)).assertFieldErrors(expected);

        assertThat(stored(living)).isEqualTo(UNCHANGED);
    }

    @ParameterizedTest
    @CsvSource(delimiterString = "|", textBlock = """
            이름은 50자까지              | NAME50 | 0           | 2026-11-01
            시작 잔액의 아래 끝          | 가     | -9999999999 | 2026-11-01
            시작 잔액의 위 끝            | 나     | 9999999999  | 2026-11-01
            기준일의 처음                | 다     | 0           | 2000-01-01
            기준일의 끝(서울의 오늘+1년) | 라     | 0           | 2027-11-28
            """)
    void 범위의_끝은_받는다(String label, String name, String openingBalance, String openingDate) throws Exception {
        String actualName = name.equals("NAME50") ? "가".repeat(50) : name;

        Reply reply = put(living, body(quoted(actualName), "\"CASH\"", openingBalance, quoted(openingDate)));

        assertThat(reply.status()).as(label + " " + reply.body()).isEqualTo(200);
        assertThat(reply.json().get("balance").asString()).isEqualTo(openingBalance);
    }

    @Test
    void 여러_칸이_틀리면_형식_오류를_모두_담고_같은_이름은_자기_자신을_빼고_형식이_모두_맞을_때만_본다() throws Exception {
        UUID savings = fixtures.account(owner, ledgerId, "비상금", AccountType.CASH, 0, OPENING).getId();

        put(living, "{}").assertFieldErrors("name:REQUIRED", "type:REQUIRED", "openingBalance:REQUIRED",
                "openingDate:REQUIRED");
        put(living, body(quoted("가".repeat(51)), "0", "10000000000", "\"1999-12-31\"")).assertFieldErrors(
                "name:TOO_LONG", "type:INVALID_FORMAT", "openingBalance:OUT_OF_RANGE", "openingDate:OUT_OF_RANGE");
        put(savings, body("\" 생활비 \"", "\"CASH\"", "0", "\"2026-11-01\"")).assertFieldErrors("name:DUPLICATE");
        put(savings, body("\"생활비\"", "\"bank\"", "0", "\"2026-11-01\"")).assertFieldErrors("type:INVALID_FORMAT");
        assertThat(stored(savings)).isEqualTo("비상금 CASH 0 2026-11-01");

        Reply ownName = put(living, body("\"생활비\"", "\"CASH\"", "7000", "\"2026-11-01\""));

        assertThat(ownName.status()).as("자기 이름과는 겹치지 않는다 " + ownName.body()).isEqualTo(200);
        assertThat(stored(living)).isEqualTo("생활비 CASH 7000 2026-11-01");
    }

    /** 두 요청이 모두 "같은 이름 없음"을 본 뒤 저장하면 나중 것이 DB 제약에 걸린다. 앱 검사와 같은 응답이다. */
    @Test
    void 동시에_같은_이름으로_고쳐도_같은_400이다() throws Exception {
        UUID savings = fixtures.account(owner, ledgerId, "비상금", AccountType.CASH, 0, OPENING).getId();
        Reply checkedByApp = put(savings, json(valid()));
        doReturn(false).when(accountRepository).existsByLedgerIdAndNameAndIdNot(any(), any(), any());

        Reply checkedByDb = put(savings, json(valid()));

        checkedByDb.assertFieldErrors("name:DUPLICATE");
        assertThat(withoutRequestId(checkedByDb)).isEqualTo(withoutRequestId(checkedByApp));
        assertThat(stored(savings)).isEqualTo("비상금 CASH 0 2026-11-01");
    }

    /** 내가 구성원인 다른 장부의 계좌, 남의 계좌, 없는 계좌, 형식이 틀린 id는 본문이 틀려도 같은 404이고 바꾸지 않는다. */
    @Test
    void 경로의_장부의_계좌가_아니면_같은_404다() throws Exception {
        User other = user();
        UUID shared = fixtures.personalLedgerId(other);
        fixtures.addMember(shared, owner, LedgerRole.MEMBER);
        UUID sharedCash = fixtures.account(other, shared, "같이쓰는현금", AccountType.CASH, 0, OPENING).getId();
        User stranger = user();
        UUID strangerCash = fixtures.account(stranger, fixtures.personalLedgerId(stranger), "남의현금",
                AccountType.CASH, 0, OPENING).getId();
        String valid = json(valid());
        Reply missing = put(UUID.randomUUID(), valid);

        for (Object target : List.of(sharedCash, strangerCash, "x")) {
            for (String body : List.of(valid, "{\"name\":1}")) {
                Reply reply = put(target, body).assertProblem(404, "Not Found", "NOT_FOUND");
                assertThat(withoutRequestId(reply)).as(target + " " + body).isEqualTo(withoutRequestId(missing));
            }
        }
        assertThat(List.of(stored(sharedCash), stored(strangerCash)))
                .containsExactly("같이쓰는현금 CASH 0 2026-11-01", "남의현금 CASH 0 2026-11-01");
        // 대조: 그 계좌의 장부 경로로는 고쳐진다.
        assertThat(client.send("PUT", "/api/v1/ledgers/" + shared + "/accounts/" + sharedCash, valid,
                "Content-Type", "application/json").status()).isEqualTo(200);
    }

    /** 401 → 415 → 404다(추가와 같다). 응답할 수 없는 {@code Accept}와 JSON이 아닌 본문은 바꾸기 전에 거절한다(ADR 002 5절). */
    @Test
    void 인증과_Content_Type이_구성원_확인보다_먼저이고_받을_수_없는_요청은_바꾸기_전에_거절한다() throws Exception {
        String path = path() + "/" + living;
        String renamed = json(valid()).replace("생활비", "바꾼이름");
        ServerClient outsider = ServerClient.signedIn(port, user().getId(), NOW);

        ServerClient.anonymous(port).send("PUT", path, renamed, "Content-Type", "application/json")
                .assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
        outsider.send("PUT", path, renamed, "Content-Type", "text/plain")
                .assertProblem(415, "Unsupported Media Type", "UNSUPPORTED_MEDIA_TYPE");
        outsider.send("PUT", path, "{", "Content-Type", "application/json")
                .assertProblem(404, "Not Found", "NOT_FOUND");
        client.send("PUT", path, renamed, "Content-Type", "application/json", "Accept", "text/html")
                .assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
        client.send("PUT", path, renamed).assertProblem(415, "Unsupported Media Type", "UNSUPPORTED_MEDIA_TYPE");
        put(living, "{").assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
        put(living, renamed + " {}").assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
        put(living, "[]").assertFieldErrors(":INVALID_FORMAT");

        assertThat(stored(living)).isEqualTo(UNCHANGED);
    }

    // ---------------------------------------------------------------- 도우미

    /** 고친 응답의 잔액. 목록이 주는 그 계좌의 잔액과 같은지도 본다. */
    private long balanceAfter(UUID account, String openingBalance, String openingDate) throws Exception {
        Reply reply = put(account, body("\"월급통장\"", "\"BANK\"", openingBalance, quoted(openingDate)));
        assertThat(reply.status()).as(reply.body()).isEqualTo(200);
        long balance = reply.json().get("balance").asLong();
        assertThat(reply.json().get("openingBalance").asString()).as("시작 잔액은 보낸 값 그대로").isEqualTo(openingBalance);
        JsonNode listed = client.get(path()).json().get("items").valueStream()
                .filter(item -> item.get("id").asString().equals(account.toString()))
                .findFirst().orElseThrow();
        assertThat(listed.get("balance").asLong()).as("목록의 잔액").isEqualTo(balance);
        return balance;
    }

    private Reply put(Object accountId, String json) throws Exception {
        return client.send("PUT", path() + "/" + accountId, json, "Content-Type", "application/json",
                "Accept", "application/json");
    }

    /** DB에 저장된 이름, 종류, 시작 잔액, 기준일. */
    private String stored(UUID accountId) {
        return jdbc.queryForObject("""
                select name || ' ' || type || ' ' || opening_balance || ' ' || opening_date
                  from account where id = ?
                """, String.class, accountId);
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
