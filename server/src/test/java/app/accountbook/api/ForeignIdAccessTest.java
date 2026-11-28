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
import app.accountbook.transaction.TransactionView;
import app.accountbook.user.User;
import java.time.Instant;
import java.time.LocalDate;
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
 * 다른 장부 접근 거부(#19)의 나머지 절반: A가 <b>자기 장부</b> 경로에 B의 계좌·카테고리·거래 id를 경로, 본문, 쿼리로 넣는다.
 * 장부 자리에 B의 장부를 넣는 절반은 {@link AccountAccessTest}가 본다. 줄마다 B의 id와 없는 id의 응답이 id 글자만 빼고
 * 같고(P-903), 정한 거부(404 또는 그 입력란의 NOT_FOUND)이며, 응답에 B의 값이 없고, DB가 그대로다.
 */
@LedgerApiTest
class ForeignIdAccessTest {

    private static final Instant NOW = Instant.parse("2026-11-27T03:00:00Z");
    private static final LocalDate DAY = LocalDate.of(2026, 11, 18);

    @LocalServerPort int port;
    @Autowired StoppedClock clock;
    @Autowired Fixtures fixtures;
    @Autowired CategoryService categoryService;
    @Autowired JdbcTemplate jdbc;

    private ServerClient a;
    private UUID ledgerA;
    private UUID aCash;
    private UUID aFood;
    private TransactionView aExpense;
    private UUID ledgerB;
    private Ids foreign;
    private List<String> secretsOfB;

    @BeforeEach
    void setUp() {
        clock.stopAt(NOW);
        User userA = fixtures.user(UUID.randomUUID().toString().substring(0, 18) + "@example.com");
        ledgerA = fixtures.personalLedgerId(userA);
        aCash = fixtures.account(userA, ledgerA, "A현금", AccountType.CASH, 1_000, DAY).getId();
        aFood = categoryService.create(userA.getId(), ledgerA,
                new CategoryCommand("A식비", CategoryKind.EXPENSE, null)).getId();
        aExpense = fixtures.expense(userA, ledgerA, aCash, aFood, DAY, 500);
        a = ServerClient.signedIn(port, userA.getId(), NOW);

        User userB = fixtures.user(UUID.randomUUID().toString().substring(0, 18) + "@example.com");
        ledgerB = fixtures.personalLedgerId(userB);
        UUID bBank = fixtures.account(userB, ledgerB, "B월급통장", AccountType.BANK, 5_432_100, DAY).getId();
        UUID bFood = categoryService.create(userB.getId(), ledgerB,
                new CategoryCommand("B식비", CategoryKind.EXPENSE, null)).getId();
        UUID bExpense = fixtures.expense(userB, ledgerB, bBank, bFood, DAY, 73_100).id();
        foreign = new Ids(bBank, bFood, bExpense);
        // A가 보낸 B의 id는 A가 이미 아는 값이라 넣지 않는다. B의 장부 id와 이름, 금액, 잔액, 이메일은 A가 모른다.
        secretsOfB = List.of("B월급통장", "B식비", "5432100", "5359000", "73100", userB.getEmail(),
                ledgerB.toString());
    }

    /** HTTP 테스트는 롤백되지 않는다. 거래 수를 DB 전체로 세는 테스트가 있어 만든 거래를 지운다. */
    @AfterEach
    void removeTransactions() {
        for (UUID ledger : List.of(ledgerA, ledgerB)) {
            jdbc.update("delete from change_log where ledger_id = ?", ledger);
            jdbc.update("delete from transaction where ledger_id = ?", ledger);
        }
    }

    @TestFactory
    Stream<DynamicTest> A는_자기_장부_경로로도_B의_id에_닿을_수_없다() {
        return cases().stream().map(row -> dynamicTest(row.label(), () -> verifyDenied(row)));
    }

    /** A의 장부 경로에서 B의 id 자리만 다른 요청들과, 그 자리가 B의 것이거나 없는 id일 때 받는 거부. */
    private List<Case> cases() {
        String account = "{\"name\":\"새 이름\",\"type\":\"BANK\",\"openingBalance\":0,\"openingDate\":\"2026-11-18\"}";
        return List.of(
                notFound("계좌 고치기", (c, ids) -> c.send("PUT", accounts() + "/" + ids.account(), account,
                        "Content-Type", "application/json")),
                notFound("계좌 숨기기", (c, ids) -> c.send("PUT", accounts() + "/" + ids.account() + "/visibility",
                        "{\"hidden\":true}", "Content-Type", "application/json")),
                notFound("계좌 지우기", (c, ids) -> c.send("DELETE", accounts() + "/" + ids.account(), null)),
                notFound("카테고리 이름 바꾸기", (c, ids) -> c.send("PUT", categories() + "/" + ids.category(),
                        "{\"name\":\"새 이름\"}", "Content-Type", "application/json")),
                notFound("카테고리 삭제 영향", (c, ids) ->
                        c.get(categories() + "/" + ids.category() + "/deletion-impact")),
                notFound("카테고리 지우기", (c, ids) -> c.send("DELETE", categories() + "/" + ids.category(), null)),
                field("카테고리 지우기(B의 카테고리로 옮기기)", "targetCategoryId:NOT_FOUND", (c, ids) -> c.send("DELETE",
                        categories() + "/" + aFood + "?targetCategoryId=" + ids.category(), null)),
                field("하위 카테고리 추가(B의 상위)", "parentId:NOT_FOUND", (c, ids) -> c.postJson(categories(),
                        "{\"kind\":\"EXPENSE\",\"name\":\"하위\",\"parentId\":\"" + ids.category() + "\"}")),
                notFound("거래 상세", (c, ids) -> c.get(transactions() + "/" + ids.transaction())),
                notFound("변경 이력", (c, ids) -> c.get(transactions() + "/" + ids.transaction() + "/history")),
                notFound("거래 고치기", (c, ids) -> c.send("PUT", transactions() + "/" + ids.transaction(),
                        expense(null, aCash, aFood, 1L), "Content-Type", "application/json")),
                notFound("거래 지우기", (c, ids) ->
                        c.send("DELETE", transactions() + "/" + ids.transaction() + "?version=1", null)),
                notFound("거래 되살리기", (c, ids) ->
                        c.postJson(transactions() + "/" + ids.transaction() + "/restore", "{\"version\":1}")),
                notFound("거래 완전히 지우기", (c, ids) ->
                        c.postJson(transactions() + "/" + ids.transaction() + "/purge", "{\"version\":1}")),
                notFound("거래 승인취소", (c, ids) ->
                        c.postJson(transactions() + "/" + ids.transaction() + "/cancel", "{\"version\":1}")),
                notFound("거래 취소 되돌리기", (c, ids) ->
                        c.postJson(transactions() + "/" + ids.transaction() + "/uncancel", "{\"version\":1}")),
                field("거래 만들기(B의 계좌)", "accountId:NOT_FOUND", (c, ids) ->
                        c.postJson(transactions(), expense(UUID.randomUUID(), ids.account(), aFood, null))),
                field("거래 만들기(B의 카테고리)", "categoryId:NOT_FOUND", (c, ids) ->
                        c.postJson(transactions(), expense(UUID.randomUUID(), aCash, ids.category(), null))),
                field("이체 만들기(받는 계좌가 B의 계좌)", "toAccountId:NOT_FOUND", (c, ids) ->
                        c.postJson(transactions(), transfer(aCash, ids.account()))),
                field("A의 거래 고치기(B의 계좌로)", "accountId:NOT_FOUND", (c, ids) -> c.send("PUT",
                        transactions() + "/" + aExpense.id(), expense(null, ids.account(), aFood, aExpense.version()),
                        "Content-Type", "application/json")),
                field("A의 거래 고치기(B의 카테고리로)", "categoryId:NOT_FOUND", (c, ids) -> c.send("PUT",
                        transactions() + "/" + aExpense.id(), expense(null, aCash, ids.category(), aExpense.version()),
                        "Content-Type", "application/json")),
                field("거래 목록(B의 계좌 필터)", "accountId:NOT_FOUND", (c, ids) ->
                        c.get(transactions() + "?month=2026-11&accountId=" + ids.account())),
                field("거래 목록(B의 카테고리 필터)", "categoryId:NOT_FOUND", (c, ids) ->
                        c.get(transactions() + "?month=2026-11&categoryId=" + ids.category())),
                field("거래 검색(B의 계좌 필터)", "accountId:NOT_FOUND", (c, ids) ->
                        c.get(transactions() + "/search?q=B&accountId=" + ids.account())),
                field("거래 검색(B의 카테고리 필터)", "categoryId:NOT_FOUND", (c, ids) ->
                        c.get(transactions() + "/search?q=B&categoryId=" + ids.category())));
    }

    private void verifyDenied(Case row) throws Exception {
        Map<String, List<Map<String, Object>>> before = snapshot();
        Ids missing = new Ids(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID());
        Reply missed = row.request().send(a, missing);

        Reply denied = row.request().send(a, foreign);

        if (row.fieldError() == null) {
            denied.assertProblem(404, "Not Found", "NOT_FOUND");
        } else {
            denied.assertFieldErrors(row.fieldError());
        }
        assertThat(normalized(denied, foreign)).as("없는 id와 같은 응답").isEqualTo(normalized(missed, missing));
        assertThat(endToEndHeaders(denied)).isEqualTo(endToEndHeaders(missed));
        assertThat(String.join("\n", denied.body(), denied.headers().toString())).doesNotContain(secretsOfB);
        assertThat(snapshot()).as("DB가 그대로다").isEqualTo(before);
    }

    /** 요청 id와 보낸 id 글자를 자리 이름으로 바꾼 본문. 보낸 id를 되돌려 주는지는 B의 id와 없는 id가 같게 다룬다. */
    private static String normalized(Reply reply, Ids ids) {
        return reply.body().replace(reply.header("X-Request-Id"), "<request>")
                .replace(ids.account().toString(), "<account>")
                .replace(ids.category().toString(), "<category>")
                .replace(ids.transaction().toString(), "<transaction>");
    }

    /** {@link AccountAccessTest}와 같은 까닭으로 연결을 다루는 헤더를 뺀다. */
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

    /** 지출 본문. id가 null이면 고치기, version이 null이면 만들기 본문이다. */
    private static String expense(UUID id, UUID account, UUID category, Long version) {
        return "{" + (id == null ? "" : "\"id\":\"" + id + "\",") + "\"type\":\"EXPENSE\",\"occurredOn\":\"2026-11-18\""
                + ",\"accountId\":\"" + account + "\",\"categoryId\":\"" + category + "\",\"amount\":1000"
                + (version == null ? "" : ",\"version\":" + version) + "}";
    }

    private static String transfer(UUID from, UUID to) {
        return "{\"id\":\"" + UUID.randomUUID() + "\",\"type\":\"TRANSFER\",\"occurredOn\":\"2026-11-18\""
                + ",\"fromAccountId\":\"" + from + "\",\"toAccountId\":\"" + to + "\",\"amount\":1000}";
    }

    private String accounts() {
        return "/api/v1/ledgers/" + ledgerA + "/accounts";
    }

    private String categories() {
        return "/api/v1/ledgers/" + ledgerA + "/categories";
    }

    private String transactions() {
        return "/api/v1/ledgers/" + ledgerA + "/transactions";
    }

    private static Case notFound(String label, Request request) {
        return new Case(label, null, request);
    }

    private static Case field(String label, String fieldError, Request request) {
        return new Case(label, fieldError, request);
    }

    private record Ids(UUID account, UUID category, UUID transaction) {
    }

    @FunctionalInterface
    private interface Request {
        Reply send(ServerClient client, Ids ids) throws Exception;
    }

    /** fieldError가 null이면 404 NOT_FOUND, 아니면 그 입력란만 NOT_FOUND인 400이다. */
    private record Case(String label, String fieldError, Request request) {
    }
}
