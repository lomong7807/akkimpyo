package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.account.AccountType;
import app.accountbook.api.ServerClient.Reply;
import app.accountbook.category.CategoryCommand;
import app.accountbook.category.CategoryKind;
import app.accountbook.category.CategoryService;
import app.accountbook.ledger.LedgerRole;
import app.accountbook.support.Fixtures;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.transaction.TransactionService;
import app.accountbook.user.User;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.JsonNode;

/** {@code PUT /api/v1/ledgers/{ledgerId}/transactions/{id}}(#36 요청과 응답 계약). */
@LedgerApiTest
class TransactionUpdateTest {

    /** 서울은 2026-11-27 12:00이다. 날짜의 끝은 2027-11-27이다. */
    private static final Instant NOW = Instant.parse("2026-11-27T03:00:00Z");
    private static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    private static final String DEVICE = "X-Akkimpyo-Device";

    @LocalServerPort int port;
    @Autowired StoppedClock clock;
    @Autowired Fixtures fixtures;
    @Autowired CategoryService categoryService;
    @Autowired TransactionService transactionService;
    @Autowired JdbcTemplate jdbc;

    private User owner;
    private UUID ledgerId;
    private UUID cash;
    private UUID bank;
    private UUID food;
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
        bank = fixtures.account(owner, ledgerId, "은행", AccountType.BANK, 0, DAY).getId();
        food = categoryService.create(owner.getId(), ledgerId,
                new CategoryCommand("식비", CategoryKind.EXPENSE, null)).getId();
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
    void 고치면_200이고_만들기와_같은_모양에_version이_오르며_이력에_전후_값이_남는다() throws Exception {
        JsonNode created = create(expense(cash, food, 12_000, "\"08:05\""));
        UUID uncategorized = categoryService.uncategorized(ledgerId, CategoryKind.EXPENSE).getId();

        Reply updated = update(created, expense(bank, null, 15_000, "\"12:30\"").replace("2026-11-18", "2026-11-19"),
                1, DEVICE, "iphone.safari");

        assertThat(updated.status()).as(updated.body()).isEqualTo(200);
        assertThat(updated.header("Content-Type")).isEqualTo("application/json");
        JsonNode tx = updated.json();
        assertThat(tx.propertyNames()).containsExactlyInAnyOrderElementsOf(created.propertyNames());
        assertThat(List.of(tx.get("id"), tx.get("createdAt"), tx.get("createdBy"), tx.get("paidBy")))
                .containsExactly(created.get("id"), created.get("createdAt"), created.get("createdBy"),
                        created.get("paidBy"));
        assertThat(text(tx, "occurredOn", "occurredTime", "accountId", "categoryId"))
                .containsExactly("2026-11-19", "12:30", bank.toString(), uncategorized.toString());
        assertThat(tx.get("amount").asLong()).isEqualTo(15_000);
        assertThat(tx.get("version").asLong()).isEqualTo(2);
        assertThat(tx.get("updatedBy")).isEqualTo(created.get("createdBy"));
        assertThat(history(created)).containsExactly("CREATE unknown null -12000", "UPDATE iphone.safari -12000 -15000");
    }

    /** 수정 때 시각이 반영되고, 비우면 옛 값이 남지 않고 시각 없음이 된다(#36 테스트 보강). 기기 헤더가 없으면 unknown이다. */
    @Test
    void 이체를_고치면_계좌와_금액이_바뀌고_시각을_비우면_시각_없음이_된다() throws Exception {
        JsonNode created = create(transfer(bank, cash, 50_000, "\"23:59\""));

        Reply updated = update(created, transfer(cash, bank, 70_000, "null"), 1);

        assertThat(updated.status()).as(updated.body()).isEqualTo(200);
        JsonNode tx = updated.json();
        assertThat(text(tx, "fromAccountId", "toAccountId")).containsExactly(cash.toString(), bank.toString());
        assertThat(List.of(tx.get("occurredTime"), tx.get("accountId"), tx.get("payee"))).allMatch(JsonNode::isNull);
        assertThat(tx.get("amount").asLong()).isEqualTo(70_000);
        assertThat(jdbc.queryForObject("select occurred_time is null from transaction where id = ?", Boolean.class,
                id(created))).isTrue();
        // 이체 라인의 순서는 정해져 있지 않아 동작과 기기 값만 본다.
        assertThat(history(created)).last().asString().startsWith("UPDATE unknown ");
    }

    /** 비교는 재전송 판정과 같은 값 맞추기를 거친다. 본문의 id는 읽지 않는다. */
    @Test
    void 같은_내용이면_200이고_version을_올리지_않으며_이력을_남기지_않는다() throws Exception {
        JsonNode created = create(expense(cash, null, 12_000, "\"08:05\""));

        Reply same = update(created, expense(cash, null, 12_000, "\"08:05\"")
                .replace("\"김밥천국\"", "\" 김밥천국 \"").replace("{", "{\"id\":\"" + UUID.randomUUID() + "\","), 1);

        assertThat(same.status()).as(same.body()).isEqualTo(200);
        assertThat(same.json()).isEqualTo(created);
        assertThat(history(created)).hasSize(1);
    }

    @Test
    void 종류를_바꾸면_400_type_NOT_ALLOWED이고_바꾸지_않는다() throws Exception {
        JsonNode created = create(expense(cash, food, 12_000, "null"));

        // 수입 카테고리가 아니라도 종류가 먼저다(참조 검증보다 앞).
        update(created, expense(cash, food, 12_000, "null").replace("EXPENSE", "INCOME"), 1)
                .assertFieldErrors("type:NOT_ALLOWED");
        update(created, transfer(cash, bank, 12_000, "null"), 1).assertFieldErrors("type:NOT_ALLOWED");

        assertThat(history(created)).hasSize(1);
    }

    @Test
    void 낡은_version이면_409이고_current는_최신_거래다_휴지통이면_deletedAt이_있다() throws Exception {
        JsonNode created = create(expense(cash, food, 12_000, "null"));
        Reply first = update(created, expense(cash, food, 15_000, "null"), 1);

        Reply stale = update(created, expense(cash, food, 20_000, "null"), 1);

        stale.assertProblem(409, "Conflict", "STALE_VERSION");
        assertThat(stale.json().get("current")).isEqualTo(first.json());
        transactionService.delete(owner.getId(), id(created), 2, "test-device");
        JsonNode trashed = update(created, expense(cash, food, 20_000, "null"), 2)
                .assertProblem(409, "Conflict", "STALE_VERSION").json().get("current");
        assertThat(trashed.get("version").asLong()).isEqualTo(3);
        assertThat(List.of(trashed.get("deletedAt"), trashed.get("purgeAt"))).noneMatch(JsonNode::isNull);
        assertThat(history(created)).hasSize(3);
    }

    @Test
    void 휴지통의_거래는_version이_맞아도_409_INVALID_STATE다() throws Exception {
        JsonNode created = create(expense(cash, food, 12_000, "null"));
        transactionService.delete(owner.getId(), id(created), 1, "test-device");

        update(created, expense(cash, food, 15_000, "null"), 2).assertProblem(409, "Conflict", "INVALID_STATE");

        assertThat(history(created)).hasSize(2);
    }

    /** 내가 구성원인 다른 장부의 거래, 남의 거래, 완전히 지운 거래, 없는 거래는 본문이 틀려도 같은 404다. */
    @Test
    void 경로의_장부의_거래가_아니면_같은_404이고_바꾸지_않는다() throws Exception {
        User other = user();
        UUID shared = fixtures.personalLedgerId(other);
        ledgers.add(shared);
        fixtures.addMember(shared, owner, LedgerRole.MEMBER);
        UUID sharedCash = fixtures.account(other, shared, "같이쓰는현금", AccountType.CASH, 0, DAY).getId();
        UUID inShared = fixtures.expense(other, shared, sharedCash, null, DAY, 7_000).id();
        User stranger = user();
        UUID strangers = fixtures.personalLedgerId(stranger);
        ledgers.add(strangers);
        UUID strangerCash = fixtures.account(stranger, strangers, "남의현금", AccountType.CASH, 0, DAY).getId();
        UUID ofStranger = fixtures.expense(stranger, strangers, strangerCash, null, DAY, 7_000).id();
        UUID purged = id(create(expense(cash, food, 12_000, "null")));
        transactionService.delete(owner.getId(), purged, 1, "test-device");
        fixtures.purge(purged, owner.getId());
        String valid = withVersion(expense(cash, food, 1_000, "null"), "1");
        Reply missing = put(UUID.randomUUID(), valid);

        for (UUID target : List.of(inShared, ofStranger, purged)) {
            for (String body : List.of(valid, "{\"amount\":\"x\"}")) {
                Reply reply = put(target, body).assertProblem(404, "Not Found", "NOT_FOUND");
                assertThat(withoutRequestId(reply)).isEqualTo(withoutRequestId(missing));
            }
        }
        assertThat(jdbc.queryForList("select version from transaction where id in (?, ?)", Long.class, inShared,
                ofStranger)).containsOnly(1L);
    }

    @Test
    void 형식_오류는_만들기와_같은_입력란이고_version도_함께_알린다() throws Exception {
        JsonNode expense = create(expense(cash, food, 12_000, "null"));
        JsonNode transfer = create(transfer(bank, cash, 50_000, "null"));

        put(id(expense), "{}").assertFieldErrors("type:REQUIRED", "occurredOn:REQUIRED", "amount:REQUIRED",
                "version:REQUIRED");
        put(id(expense), withVersion(expense(cash, food, 12_000, "null"), "\"1\""))
                .assertFieldErrors("version:INVALID_FORMAT");
        put(id(expense), withVersion(expense(cash, food, 12_000, "null"), "1.0"))
                .assertFieldErrors("version:INVALID_FORMAT");
        update(expense, expense(cash, food, 0, "null"), 1).assertFieldErrors("amount:OUT_OF_RANGE");
        update(expense, expense(cash, food, 1_000, "null").replace("김밥천국", "가".repeat(101)), 1)
                .assertFieldErrors("payee:TOO_LONG");
        update(expense, expense(cash, food, 1_000, "null"), 1, DEVICE, "a b")
                .assertFieldErrors("X-Akkimpyo-Device:INVALID_FORMAT");
        update(transfer, transfer(cash, cash, 1_000, "null"), 1).assertFieldErrors("toAccountId:NOT_ALLOWED");
        update(transfer, transfer(bank, cash, 10_000_000_000L, "null"), 1).assertFieldErrors("amount:OUT_OF_RANGE");
        update(transfer, transfer(bank, cash, 1_000, "null").replace("2026-11-18", "2027-11-28"), 1)
                .assertFieldErrors("occurredOn:OUT_OF_RANGE");
        update(transfer, transfer(bank, cash, 1_000, "null").replace("2026-11-18", "1999-12-31"), 1)
                .assertFieldErrors("occurredOn:OUT_OF_RANGE");

        assertThat(List.of(history(expense), history(transfer))).allSatisfy(rows -> assertThat(rows).hasSize(1));
    }

    @Test
    void 형식이_version보다_version이_상태보다_상태가_참조보다_먼저다() throws Exception {
        User other = user();
        UUID othersLedger = fixtures.personalLedgerId(other);
        UUID othersCash = fixtures.account(other, othersLedger, "남의현금", AccountType.CASH, 0, DAY).getId();
        JsonNode created = create(expense(cash, food, 12_000, "null"));

        update(created, expense(cash, food, 0, "null"), 9).assertFieldErrors("amount:OUT_OF_RANGE");
        update(created, expense(othersCash, food, 1_000, "null"), 9).assertProblem(409, "Conflict", "STALE_VERSION");
        update(created, expense(othersCash, food, 1_000, "null"), 1).assertFieldErrors("accountId:NOT_FOUND");
        transactionService.delete(owner.getId(), id(created), 1, "test-device");
        update(created, expense(othersCash, food, 1_000, "null"), 2).assertProblem(409, "Conflict", "INVALID_STATE");
    }

    /** 413 → 401 → 415 → 404다. 만들기와 같다. 415는 경로만 보고 정해져 장부에 관해 드러내는 것이 없다. */
    @Test
    void 본문_상한과_인증과_Content_Type이_구성원_확인보다_먼저다() throws Exception {
        String path = "/api/v1/ledgers/" + ledgerId + "/transactions/" + UUID.randomUUID();
        ServerClient anyone = ServerClient.anonymous(port);
        ServerClient outsider = ServerClient.signedIn(port, user().getId(), NOW);
        String big = "{}" + " ".repeat(64 * 1024);

        anyone.rawReply("PUT " + path + " HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n"
                        + "Content-Type: text/plain\r\nContent-Length: " + big.length() + "\r\n\r\n" + big)
                .assertProblem(413, "Content Too Large", "PAYLOAD_TOO_LARGE");
        anyone.send("PUT", path, "x", "Content-Type", "text/plain").assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
        outsider.send("PUT", path, "x", "Content-Type", "text/plain")
                .assertProblem(415, "Unsupported Media Type", "UNSUPPORTED_MEDIA_TYPE");
        outsider.send("PUT", path, "{", "Content-Type", "application/json").assertProblem(404, "Not Found", "NOT_FOUND");
        client.send("PUT", path, "{}", "Content-Type", "application/json", "Accept", "text/html")
                .assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
    }

    // ---------------------------------------------------------------- 도우미

    private User user() {
        return fixtures.user(UUID.randomUUID().toString().substring(0, 18) + "@example.com");
    }

    /** 새 id로 만들고 응답의 거래를 돌려준다. */
    private JsonNode create(String body) throws Exception {
        Reply created = client.send("POST", "/api/v1/ledgers/" + ledgerId + "/transactions",
                "{\"id\":\"" + UUID.randomUUID() + "\"," + body.substring(1), "Content-Type", "application/json");
        assertThat(created.status()).as(created.body()).isEqualTo(201);
        return created.json();
    }

    private Reply update(JsonNode tx, String body, long version, String... headers) throws Exception {
        return put(id(tx), withVersion(body, String.valueOf(version)), headers);
    }

    private Reply put(UUID id, String json, String... headers) throws Exception {
        String[] all = new String[headers.length + 4];
        all[0] = "Content-Type";
        all[1] = "application/json";
        all[2] = "Accept";
        all[3] = "application/json";
        System.arraycopy(headers, 0, all, 4, headers.length);
        return client.send("PUT", "/api/v1/ledgers/" + ledgerId + "/transactions/" + id, json, all);
    }

    /** 이력의 "동작 기기 고치기_전_첫_라인_금액 고친_뒤_첫_라인_금액", version 순. */
    private List<String> history(JsonNode tx) {
        return jdbc.queryForList("""
                select action || ' ' || device_id || ' ' || coalesce(before_value -> 'lines' -> 0 ->> 'amount', 'null')
                       || ' ' || (after_value -> 'lines' -> 0 ->> 'amount')
                  from change_log where transaction_id = ? order by version
                """, String.class, id(tx));
    }

    private static UUID id(JsonNode tx) {
        return UUID.fromString(tx.get("id").asString());
    }

    /** @param version JSON 글자 그대로 */
    private static String withVersion(String body, String version) {
        return body.substring(0, body.length() - 1) + ",\"version\":" + version + "}";
    }

    /** @param time JSON 글자 그대로. category가 null이면 미분류로 보낸다 */
    private static String expense(UUID account, UUID category, long amount, String time) {
        return "{\"type\":\"EXPENSE\",\"occurredOn\":\"2026-11-18\",\"occurredTime\":" + time + ",\"accountId\":\""
                + account + "\",\"categoryId\":" + (category == null ? "null" : "\"" + category + "\"")
                + ",\"amount\":" + amount + ",\"payee\":\"김밥천국\",\"memo\":\"점심\"}";
    }

    private static String transfer(UUID from, UUID to, long amount, String time) {
        return "{\"type\":\"TRANSFER\",\"occurredOn\":\"2026-11-18\",\"occurredTime\":" + time + ",\"fromAccountId\":\""
                + from + "\",\"toAccountId\":\"" + to + "\",\"amount\":" + amount + ",\"memo\":\"용돈\"}";
    }

    private static List<String> text(JsonNode node, String... fields) {
        return Arrays.stream(fields).map(field -> node.get(field).asString()).toList();
    }

    private static String withoutRequestId(Reply reply) {
        return reply.body().replace(reply.header("X-Request-Id"), "");
    }
}
