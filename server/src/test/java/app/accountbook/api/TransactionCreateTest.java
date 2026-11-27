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
import app.accountbook.transaction.ChangeAction;
import app.accountbook.user.User;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** {@code POST /api/v1/ledgers/{ledgerId}/transactions}(#14 요청과 응답 계약, ADR 006 결정 3). */
@LedgerApiTest
class TransactionCreateTest {

    private static final Instant NOW = Instant.parse("2026-11-27T03:00:00Z");
    private static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    private static final String DEVICE = "X-Akkimpyo-Device";
    private static final JsonMapper JSON = new JsonMapper();
    private static final String SERVER_TIME = "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z";

    @LocalServerPort int port;
    @Autowired StoppedClock clock;
    @Autowired Fixtures fixtures;
    @Autowired CategoryService categoryService;
    @Autowired JdbcTemplate jdbc;

    private User owner;
    private UUID ledgerId;
    private UUID cash;
    private UUID bank;
    private UUID food;
    private ServerClient client;

    @BeforeEach
    void setUp() {
        clock.stopAt(NOW);
        owner = fixtures.user(UUID.randomUUID().toString().substring(0, 18) + "@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
        cash = fixtures.account(owner, ledgerId, "현금", AccountType.CASH, 0, DAY).getId();
        bank = fixtures.account(owner, ledgerId, "은행", AccountType.BANK, 0, DAY).getId();
        food = categoryService.create(owner.getId(), ledgerId,
                new CategoryCommand("식비", CategoryKind.EXPENSE, null)).getId();
        client = ServerClient.signedIn(port, owner.getId(), NOW);
    }

    /** HTTP 테스트는 롤백되지 않는다. 거래 수를 DB 전체로 세는 테스트가 있어 만든 거래를 지운다. */
    @AfterEach
    void removeTransactions() {
        jdbc.update("delete from change_log where ledger_id = ?", ledgerId);
        jdbc.update("delete from transaction where ledger_id = ?", ledgerId);
    }

    @Test
    void 지출을_만들면_201이고_요청과_같은_단식_모양에_서버_값을_더한다() throws Exception {
        UUID id = UUID.randomUUID();

        Reply created = create(expense(id.toString().toUpperCase(), cash, food, 12_000, "\"08:05\""),
                DEVICE, "iphone.safari");

        assertThat(created.status()).as(created.body()).isEqualTo(201);
        assertThat(created.header("Content-Type")).isEqualTo("application/json");
        JsonNode tx = created.json();
        assertThat(tx.propertyNames()).containsExactlyInAnyOrder("id", "type", "occurredOn", "occurredTime",
                "accountId", "categoryId", "amount", "payee", "memo", "refund", "paidBy", "fromAccountId",
                "toAccountId", "status", "version", "createdAt", "createdBy", "updatedAt", "updatedBy", "deletedAt",
                "purgeAt");
        assertThat(tx.get("id").asString()).as("소문자").isEqualTo(id.toString());
        assertThat(text(tx, "type", "occurredOn", "occurredTime", "accountId", "categoryId", "payee", "memo",
                "status")).containsExactly("EXPENSE", "2026-11-18", "08:05", cash.toString(), food.toString(),
                "김밥천국", "점심", "POSTED");
        assertThat(tx.get("amount").isIntegralNumber()).isTrue();
        assertThat(tx.get("amount").asLong()).as("양수").isEqualTo(12_000);
        assertThat(tx.get("refund").asBoolean()).isFalse();
        assertThat(tx.get("version").asLong()).isEqualTo(1);
        assertThat(tx.get("createdAt").asString()).matches(SERVER_TIME).isEqualTo(tx.get("updatedAt").asString());
        JsonNode me = person(owner);
        assertThat(List.of(tx.get("paidBy"), tx.get("createdBy"), tx.get("updatedBy"))).containsOnly(me);
        assertThat(List.of(tx.get("fromAccountId"), tx.get("toAccountId"), tx.get("deletedAt"), tx.get("purgeAt")))
                .allMatch(JsonNode::isNull);
        assertThat(jdbc.queryForList("select amount from transaction_line where transaction_id = ?", Long.class, id))
                .containsExactly(-12_000L);
        assertThat(devices(id)).containsExactly("iphone.safari");
    }

    @Test
    void 수입은_카테고리를_비우면_미분류로_저장되고_그_id를_돌려준다() throws Exception {
        UUID id = UUID.randomUUID();
        UUID uncategorized = categoryService.uncategorized(ledgerId, CategoryKind.INCOME).getId();

        Reply created = create(json(Map.of("id", quoted(id), "type", "\"INCOME\"", "occurredOn", "\"2026-11-18\"",
                "accountId", quoted(bank), "amount", "3000000")));

        assertThat(created.status()).as(created.body()).isEqualTo(201);
        JsonNode tx = created.json();
        assertThat(tx.get("categoryId").asString()).isEqualTo(uncategorized.toString());
        assertThat(List.of(tx.get("occurredTime"), tx.get("payee"), tx.get("memo"))).allMatch(JsonNode::isNull);
        assertThat(tx.get("refund").asBoolean()).isFalse();
        assertThat(tx.get("amount").asLong()).isEqualTo(3_000_000);
        assertThat(jdbc.queryForList("select amount from transaction_line where transaction_id = ?", Long.class, id))
                .containsExactly(3_000_000L);
    }

    @Test
    void 이체는_라인_2줄로_저장되고_지출의_칸은_null이다() throws Exception {
        UUID id = UUID.randomUUID();

        Reply created = create(transfer(id, bank, cash, 50_000));

        assertThat(created.status()).as(created.body()).isEqualTo(201);
        JsonNode tx = created.json();
        assertThat(text(tx, "type", "fromAccountId", "toAccountId", "occurredTime", "memo"))
                .containsExactly("TRANSFER", bank.toString(), cash.toString(), "23:59", "용돈");
        assertThat(tx.get("amount").asLong()).isEqualTo(50_000);
        assertThat(List.of(tx.get("accountId"), tx.get("categoryId"), tx.get("payee"), tx.get("refund"),
                tx.get("paidBy"))).allMatch(JsonNode::isNull);
        assertThat(tx.get("createdBy")).isEqualTo(person(owner));
        assertThat(jdbc.queryForList("select amount from transaction_line where transaction_id = ? order by amount",
                Long.class, id)).containsExactly(-50_000L, 50_000L);
    }

    @Test
    void 같은_요청을_다시_보내면_200이고_저장된_거래를_돌려주며_새로_만들지_않는다() throws Exception {
        UUID id = UUID.randomUUID();
        Reply first = create(expense(id.toString(), cash, food, 12_000, "\"08:05\""));

        Reply resent = create(expense(id.toString().toUpperCase(), cash, food, 12_000, "\"08:05\""));

        assertThat(resent.status()).as(resent.body()).isEqualTo(200);
        assertThat(resent.json()).isEqualTo(first.json());
        assertThat(devices(id)).as("이력을 더하지 않는다").hasSize(1);
    }

    @Test
    void 내가_만든_거래에_다른_내용을_보내면_409이고_current는_저장된_거래다() throws Exception {
        UUID id = UUID.randomUUID();
        Reply first = create(expense(id.toString(), cash, food, 12_000, "\"08:05\""));

        Reply conflict = create(expense(id.toString(), cash, food, 13_000, "\"08:05\""));

        conflict.assertProblem(409, "Conflict", "ID_CONFLICT");
        assertThat(conflict.json().get("current")).isEqualTo(first.json());
        assertThat(jdbc.queryForObject("select count(*) from transaction_line where transaction_id = ?", Long.class,
                id)).isEqualTo(1);
    }

    /** 다른 장부의 id, 같은 장부의 다른 사람이 만든 거래의 id, 완전히 지운 id는 서로 구분되지 않는다(#21, ADR 006). */
    @Test
    void 쓸_수_없는_id는_current_없는_409이고_이유가_구분되지_않는다() throws Exception {
        User stranger = fixtures.user(UUID.randomUUID().toString().substring(0, 18) + "@example.com");
        UUID strangerLedger = fixtures.personalLedgerId(stranger);
        UUID strangerCash = fixtures.account(stranger, strangerLedger, "남의현금", AccountType.CASH, 0, DAY).getId();
        UUID othersLedgerTx = fixtures.expense(stranger, strangerLedger, strangerCash, null, DAY, 7_000).id();
        User member = fixtures.user(UUID.randomUUID().toString().substring(0, 18) + "@example.com");
        fixtures.addMember(ledgerId, member, LedgerRole.MEMBER);
        UUID membersTx = fixtures.expense(member, ledgerId, cash, food, DAY, 12_000).id();
        UUID purged = UUID.randomUUID();
        fixtures.purgeRecord(purged, ledgerId, ChangeAction.PURGE, owner.getId());

        List<Reply> replies = List.of(othersLedgerTx, membersTx, purged).stream()
                .map(id -> send(expense(id.toString(), cash, food, 12_000, "null")))
                .toList();

        try {
            for (Reply reply : replies) {
                reply.assertProblem(409, "Conflict", "ID_CONFLICT");
                assertThat(reply.json().has("current")).isFalse();
                assertThat(withoutRequestId(reply)).doesNotContain("남의현금", "7000", strangerLedger.toString());
                assertThat(withoutRequestId(reply)).isEqualTo(withoutRequestId(replies.getFirst()));
            }
        } finally {
            jdbc.update("delete from change_log where ledger_id = ?", strangerLedger);
            jdbc.update("delete from transaction where ledger_id = ?", strangerLedger);
        }
    }

    @Test
    void 기기_헤더가_없으면_이력에_unknown이_남고_형식이_틀리면_400이다() throws Exception {
        UUID missing = UUID.randomUUID();
        UUID malformed = UUID.randomUUID();

        assertThat(create(expense(missing.toString(), cash, food, 1_000, "null")).status()).isEqualTo(201);
        create(expense(malformed.toString(), cash, food, 1_000, "null"), DEVICE, "iphone safari")
                .assertFieldErrors("X-Akkimpyo-Device:INVALID_FORMAT");
        create(expense(malformed.toString(), cash, food, 1_000, "null"), DEVICE, "")
                .assertFieldErrors("X-Akkimpyo-Device:INVALID_FORMAT");

        assertThat(devices(missing)).containsExactly("unknown");
        assertThat(devices(malformed)).isEmpty();
    }

    @Test
    void 받을_수_없는_Accept와_JSON이_아닌_본문은_저장하기_전에_거절한다() throws Exception {
        UUID id = UUID.randomUUID();
        String valid = expense(id.toString(), cash, food, 1_000, "null");

        client.send("POST", path(), valid, "Content-Type", "application/json", "Accept", "text/html")
                .assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
        client.send("POST", path(), valid, "Content-Type", "text/plain")
                .assertProblem(415, "Unsupported Media Type", "UNSUPPORTED_MEDIA_TYPE");
        create("{").assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
        create("[]").assertFieldErrors(":INVALID_FORMAT");
        // 칸마다의 형식 규칙은 TransactionRequestTest가 본다. 여기서는 그 오류가 400으로 나가는 것만 본다.
        create("{}").assertFieldErrors("id:REQUIRED", "type:REQUIRED", "occurredOn:REQUIRED", "amount:REQUIRED");

        assertThat(devices(id)).isEmpty();
    }

    private Reply create(String json, String... headers) throws Exception {
        String[] all = new String[headers.length + 4];
        all[0] = "Content-Type";
        all[1] = "application/json";
        all[2] = "Accept";
        all[3] = "application/json";
        System.arraycopy(headers, 0, all, 4, headers.length);
        return client.send("POST", path(), json, all);
    }

    private Reply send(String json) {
        try {
            return create(json);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private String path() {
        return "/api/v1/ledgers/" + ledgerId + "/transactions";
    }

    private List<String> devices(UUID txId) {
        return jdbc.queryForList("select device_id from change_log where transaction_id = ? order by version",
                String.class, txId);
    }

    private static JsonNode person(User user) {
        return JSON.readTree("{\"id\":\"" + user.getId() + "\",\"displayName\":\"" + user.getDisplayName() + "\"}");
    }

    private static List<String> text(JsonNode node, String... fields) {
        return Arrays.stream(fields).map(field -> node.get(field).asString()).toList();
    }

    private static String expense(String id, UUID account, UUID category, long amount, String time) {
        return "{\"id\":\"" + id + "\",\"type\":\"EXPENSE\",\"occurredOn\":\"2026-11-18\",\"occurredTime\":" + time
                + ",\"accountId\":\"" + account + "\",\"categoryId\":\"" + category + "\",\"amount\":" + amount
                + ",\"payee\":\"김밥천국\",\"memo\":\"점심\"}";
    }

    private static String transfer(UUID id, UUID from, UUID to, long amount) {
        return "{\"id\":\"" + id + "\",\"type\":\"TRANSFER\",\"occurredOn\":\"2026-11-18\",\"occurredTime\":\"23:59\""
                + ",\"fromAccountId\":\"" + from + "\",\"toAccountId\":\"" + to + "\",\"amount\":" + amount
                + ",\"memo\":\"용돈\"}";
    }

    /** 값은 JSON 글자 그대로다. */
    private static String json(Map<String, String> fields) {
        return fields.entrySet().stream()
                .map(field -> "\"" + field.getKey() + "\":" + field.getValue())
                .collect(Collectors.joining(",", "{", "}"));
    }

    private static String quoted(Object value) {
        return "\"" + value + "\"";
    }

    private static String withoutRequestId(Reply reply) {
        return reply.body().replace(reply.header("X-Request-Id"), "");
    }
}
