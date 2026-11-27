package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 다른 장부 접근 거부(#19의 표를 계좌·카테고리·거래 API의 HTTP로, #13, #33, #43, #34, #44, #14, #36, #38, #47). A가 장부 자리에 B의 장부나 B의 계좌·카테고리·거래 id를 넣으면
 * 없는 id와 같은 404이고, 응답에 B의 값이 없으며, DB가 그대로다. 대조로 B 자신은 같은 요청이 열린다(틀린 본문이면 400).
 * 틀린 본문과 B가 이미 쓰는 이름도 404라, 장부가 있는지와 그 안의 이름을 알 수 없다. B의 거래 id로 만들어도 409가 아니라 404다.
 */
@LedgerApiTest
class AccountAccessTest {

    private static final Instant NOW = Instant.parse("2026-11-27T03:00:00Z");
    private static final LocalDate DAY = LocalDate.of(2026, 11, 18);

    @LocalServerPort int port;
    @Autowired StoppedClock clock;
    @Autowired Fixtures fixtures;
    @Autowired CategoryService categoryService;
    @Autowired JdbcTemplate jdbc;

    private ServerClient a;
    private ServerClient b;
    private UUID ledgerB;
    private UUID bBank;
    private UUID bFood;
    private UUID bExpense;
    private final Map<String, UUID> targets = new LinkedHashMap<>();
    private List<String> secretsOfB;

    @BeforeEach
    void setUp() {
        clock.stopAt(NOW);
        User userA = fixtures.user(UUID.randomUUID().toString().substring(0, 18) + "@example.com");
        fixtures.account(userA, fixtures.personalLedgerId(userA), "A은행", AccountType.BANK, 1_000, DAY);
        a = ServerClient.signedIn(port, userA.getId(), NOW);

        User userB = fixtures.user(UUID.randomUUID().toString().substring(0, 18) + "@example.com");
        ledgerB = fixtures.personalLedgerId(userB);
        bBank = fixtures.account(userB, ledgerB, "B월급통장", AccountType.BANK, 5_432_100, DAY).getId();
        bFood = categoryService.create(userB.getId(), ledgerB,
                new CategoryCommand("B식비", CategoryKind.EXPENSE, null)).getId();
        bExpense = fixtures.expense(userB, ledgerB, bBank, bFood, DAY, 73_100).id();
        b = ServerClient.signedIn(port, userB.getId(), NOW);

        targets.put("B의 장부", ledgerB);
        targets.put("B의 계좌 id", bBank);
        targets.put("B의 카테고리 id", bFood);
        targets.put("B의 거래 id", bExpense);
        secretsOfB = List.of("B월급통장", "B식비", "5432100", "5359000", "73100", userB.getEmail(),
                ledgerB.toString(), bBank.toString(), bFood.toString(), bExpense.toString());
    }

    /** HTTP 테스트는 롤백되지 않는다. 거래 수를 DB 전체로 세는 테스트(TransactionServiceTest 등)가 있어 만든 거래를 지운다. */
    @AfterEach
    void removeTransactions() {
        jdbc.update("delete from change_log where ledger_id = ?", ledgerB);
        jdbc.update("delete from transaction where ledger_id = ?", ledgerB);
    }

    @TestFactory
    Stream<DynamicTest> A는_B의_장부에_닿을_수_없다() {
        return cases().stream().flatMap(row -> targets.entrySet().stream()
                .map(target -> dynamicTest(row.label() + ": " + target.getKey(),
                        () -> verifyDenied(row.request(), target.getValue()))));
    }

    @TestFactory
    Stream<DynamicTest> 대조_B는_자기_장부에서_같은_요청에_답을_받는다() {
        return cases().stream().map(row -> dynamicTest(row.label(), () -> {
            Reply reply = row.request().send(b, ledgerB);
            assertThat(reply.status()).as(reply.body()).isEqualTo(row.ownerStatus());
        }));
    }

    /** 장부 자리에 무엇을 넣는지만 다른 요청들과, 장부의 주인(B)이 같은 요청을 하면 받는 상태. */
    private List<Case> cases() {
        String created = "{\"name\":\"새 계좌\",\"type\":\"CASH\",\"openingBalance\":0,\"openingDate\":\"2026-11-18\"}";
        String sameName = created.replace("새 계좌", "B월급통장");
        String bBankAsIs = "{\"name\":\"B월급통장\",\"type\":\"BANK\",\"openingBalance\":5432100,"
                + "\"openingDate\":\"2026-11-18\"}";
        return List.of(
                new Case("계좌 목록", (client, ledger) -> client.get(accounts(ledger)), 200),
                new Case("계좌 추가", (client, ledger) -> client.postJson(accounts(ledger), created), 201),
                new Case("계좌 추가(틀린 본문)", (client, ledger) -> client.postJson(accounts(ledger), "{\"name\":1}"), 400),
                new Case("계좌 추가(B가 쓰는 이름)", (client, ledger) -> client.postJson(accounts(ledger), sameName), 400),
                new Case("계좌 추가(JSON이 아님)", (client, ledger) -> client.postJson(accounts(ledger), "{"), 400),
                // B의 계좌와 같은 내용이라 대조가 B의 계좌를 바꾸지 않는다.
                new Case("계좌 고치기(같은 내용)", (client, ledger) -> putAccount(client, ledger, bBankAsIs), 200),
                new Case("계좌 고치기(틀린 본문)", (client, ledger) -> putAccount(client, ledger, "{\"name\":1}"), 400),
                // 대조가 B의 계좌를 바꾸지 않는다: 이미 보이는 계좌를 보이게 하고, 거래가 있는 계좌라 지워지지 않는다.
                new Case("계좌 다시 보이기(같은 상태)", (client, ledger) -> client.send("PUT", accounts(ledger) + "/" + bBank
                        + "/visibility", "{\"hidden\":false}", "Content-Type", "application/json"), 200),
                new Case("계좌 지우기(거래가 있음)", (client, ledger) ->
                        client.send("DELETE", accounts(ledger) + "/" + bBank, null), 409),
                new Case("카테고리 목록", (client, ledger) -> client.get(categories(ledger)), 200),
                new Case("카테고리 추가", (client, ledger) ->
                        client.postJson(categories(ledger), "{\"kind\":\"EXPENSE\",\"name\":\"새 분류\"}"), 201),
                new Case("카테고리 추가(틀린 본문)", (client, ledger) -> client.postJson(categories(ledger), "{\"kind\":1}"), 400),
                // B의 카테고리와 같은 이름이라 대조가 B의 카테고리를 바꾸지 않는다.
                new Case("카테고리 이름 바꾸기(같은 이름)", (client, ledger) -> putCategory(client, ledger, "{\"name\":\"B식비\"}"), 200),
                new Case("카테고리 이름 바꾸기(틀린 본문)", (client, ledger) -> putCategory(client, ledger, "{\"name\":1}"), 400),
                new Case("중복 경고", (client, ledger) -> client.get(transactions(ledger)
                        + "/duplicates?occurredOn=2026-11-18&amount=1000&payee=B"), 200),
                new Case("중복 경고(금액 없음)", (client, ledger) ->
                        client.get(transactions(ledger) + "/duplicates?occurredOn=2026-11-18"), 400),
                new Case("휴지통", (client, ledger) -> client.get(transactions(ledger) + "/trash"), 200),
                new Case("변경 이력", (client, ledger) ->
                        client.get(transactions(ledger) + "/" + bExpense + "/history"), 200),
                new Case("휴지통(틀린 cursor)", (client, ledger) -> client.get(transactions(ledger) + "/trash?cursor=x"), 400),
                new Case("카테고리 제안", (client, ledger) -> client.get(suggestions(ledger) + "?payee=B"), 200),
                new Case("카테고리 제안(101자 가맹점)", (client, ledger) ->
                        client.get(suggestions(ledger) + "?payee=" + "x".repeat(101)), 400),
                new Case("월별 통계", (client, ledger) ->
                        client.get("/api/v1/ledgers/" + ledger + "/stats/monthly?month=2026-11"), 200),
                new Case("내보내기", (client, ledger) -> client.get(exports(ledger, "2026-11-18")), 200),
                new Case("내보내기(종료일이 앞섬)", (client, ledger) -> client.get(exports(ledger, "2026-11-17")), 400),
                new Case("거래 만들기", (client, ledger) ->
                        client.postJson(transactions(ledger), expense(UUID.randomUUID())), 201),
                new Case("거래 만들기(B의 거래 id에 다른 내용)", (client, ledger) ->
                        client.postJson(transactions(ledger), expense(bExpense)), 409),
                new Case("거래 만들기(틀린 본문)", (client, ledger) ->
                        client.postJson(transactions(ledger), "{\"amount\":\"x\"}"), 400),
                new Case("거래 만들기(공백뿐인 본문)", (client, ledger) -> client.postJson(transactions(ledger), " "), 400),
                new Case("거래 만들기(틀린 기기 값)", (client, ledger) -> client.send("POST", transactions(ledger),
                        expense(UUID.randomUUID()), "Content-Type", "application/json", "X-Akkimpyo-Device", "a b"), 400),
                // B의 거래를 바꾸지 않는 요청만 쓴다. 대조가 B의 거래를 바꾸면 뒤의 줄의 version이 어긋난다.
                new Case("거래 고치기(같은 내용)", (client, ledger) -> put(client, ledger, bExpenseAsIs("1")), 200),
                new Case("거래 고치기(낡은 version)", (client, ledger) -> put(client, ledger, bExpenseAsIs("2")), 409),
                new Case("거래 고치기(틀린 본문)", (client, ledger) -> put(client, ledger, "{\"amount\":\"x\"}"), 400),
                new Case("거래 지우기(낡은 version)", (client, ledger) ->
                        client.send("DELETE", transactions(ledger) + "/" + bExpense + "?version=2", null), 409),
                new Case("거래 지우기(version 없음)", (client, ledger) ->
                        client.send("DELETE", transactions(ledger) + "/" + bExpense, null), 400),
                new Case("거래 되살리기(지우지 않은 거래)", (client, ledger) ->
                        client.postJson(transactions(ledger) + "/" + bExpense + "/restore", "{\"version\":1}"), 409),
                new Case("거래 되살리기(틀린 본문)", (client, ledger) ->
                        client.postJson(transactions(ledger) + "/" + bExpense + "/restore", "{}"), 400));
    }

    private Reply putAccount(ServerClient client, UUID ledger, String json) throws Exception {
        return client.send("PUT", accounts(ledger) + "/" + bBank, json, "Content-Type", "application/json");
    }

    private Reply putCategory(ServerClient client, UUID ledger, String json) throws Exception {
        return client.send("PUT", categories(ledger) + "/" + bFood, json, "Content-Type", "application/json");
    }

    private Reply put(ServerClient client, UUID ledger, String json) throws Exception {
        return client.send("PUT", transactions(ledger) + "/" + bExpense, json, "Content-Type", "application/json");
    }

    /** B의 지출과 같은 내용. */
    private String bExpenseAsIs(String version) {
        return "{\"type\":\"EXPENSE\",\"occurredOn\":\"2026-11-18\",\"accountId\":\"" + bBank + "\",\"categoryId\":\""
                + bFood + "\",\"amount\":73100,\"version\":" + version + "}";
    }

    /** B의 계좌와 카테고리를 쓴 지출. B의 거래와 금액이 달라 같은 id면 내용이 다르다. */
    private String expense(UUID id) {
        return "{\"id\":\"" + id + "\",\"type\":\"EXPENSE\",\"occurredOn\":\"2026-11-18\",\"accountId\":\"" + bBank
                + "\",\"categoryId\":\"" + bFood + "\",\"amount\":1000}";
    }

    private void verifyDenied(Request request, UUID ledger) throws Exception {
        Map<String, List<Map<String, Object>>> before = snapshot();
        Reply missing = request.send(a, UUID.randomUUID());

        Reply denied = request.send(a, ledger);

        denied.assertProblem(404, "Not Found", "NOT_FOUND");
        assertThat(denied.body().replace(denied.header("X-Request-Id"), ""))
                .as("없는 장부와 같은 응답")
                .isEqualTo(missing.body().replace(missing.header("X-Request-Id"), ""));
        assertThat(endToEndHeaders(denied)).isEqualTo(endToEndHeaders(missing));
        assertThat(String.join("\n", denied.body(), denied.headers().toString())).doesNotContain(secretsOfB);
        assertThat(snapshot()).as("DB가 그대로다").isEqualTo(before);
    }

    /**
     * 응답 헤더의 이름에서 연결을 다루는 것을 뺀다. Tomcat은 한 연결의 100번째 응답에 {@code Connection: close}를 붙여
     * (maxKeepAliveRequests) 표의 줄 수에 따라 거부 응답과 없는 장부의 응답 중 하나에만 붙는다.
     */
    private static Set<String> endToEndHeaders(Reply reply) {
        Set<String> names = new TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        names.addAll(reply.headers().keySet());
        names.removeAll(List.of("Connection", "Keep-Alive"));
        return names;
    }

    /** flyway 이력을 뺀 모든 테이블의 모든 행. */
    private Map<String, List<Map<String, Object>>> snapshot() {
        List<String> tables = jdbc.queryForList("""
                select table_name from information_schema.tables
                 where table_schema = 'public' and table_type = 'BASE TABLE'
                   and table_name <> 'flyway_schema_history'
                """, String.class);
        return tables.stream().collect(Collectors.toMap(Function.identity(),
                table -> jdbc.queryForList("select * from \"" + table + "\" order by id")));
    }

    private static String accounts(UUID ledger) {
        return "/api/v1/ledgers/" + ledger + "/accounts";
    }

    private static String categories(UUID ledger) {
        return "/api/v1/ledgers/" + ledger + "/categories";
    }

    private static String suggestions(UUID ledger) {
        return "/api/v1/ledgers/" + ledger + "/category-suggestions";
    }

    private static String exports(UUID ledger, String to) {
        return "/api/v1/ledgers/" + ledger + "/exports?format=csv&from=2026-11-18&to=" + to;
    }

    private static String transactions(UUID ledger) {
        return "/api/v1/ledgers/" + ledger + "/transactions";
    }

    @FunctionalInterface
    private interface Request {
        Reply send(ServerClient client, UUID ledger) throws Exception;
    }

    private record Case(String label, Request request, int ownerStatus) {
    }
}
