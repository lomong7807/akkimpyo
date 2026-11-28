package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.account.AccountType;
import app.accountbook.api.ServerClient.Reply;
import app.accountbook.ledger.LedgerRole;
import app.accountbook.support.Fixtures;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.transaction.TransactionService;
import app.accountbook.user.User;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.JsonNode;

/**
 * {@code POST /api/v1/ledgers/{ledgerId}/transactions/{id}/purge}와 본문 {@code {"version": N}}(#45 완전히 지우기 계약).
 * 지우는 규칙은 {@code TransactionPurgeTest}(#9)가 보고, 여기는 요청과 응답만 본다.
 */
@LedgerApiTest
class TransactionPurgeHttpTest {

    private static final Instant NOW = Instant.parse("2026-11-27T03:00:00Z");
    private static final LocalDate DAY = LocalDate.of(2026, 11, 18);

    @LocalServerPort int port;
    @Autowired StoppedClock clock;
    @Autowired Fixtures fixtures;
    @Autowired TransactionService transactionService;
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

    @Test
    void 휴지통의_거래를_지우면_본문_없는_204이고_거래와_라인이_사라지며_기록_한_행만_남는다() throws Exception {
        UUID tx = trashed();

        Reply purged = purge(tx, "{\"version\":2}");

        assertThat(purged.status()).as(purged.body()).isEqualTo(204);
        assertThat(purged.body()).isEmpty();
        assertThat(count("select count(*) from transaction where id = ?", tx)).isZero();
        assertThat(count("select count(*) from transaction_line where transaction_id = ?", tx)).isZero();
        assertThat(jdbc.queryForList("select version, action, actor_id, device_id, before_value, after_value"
                + " from change_log where transaction_id = ?", tx)).singleElement().satisfies(log -> assertThat(log)
                .containsEntry("version", 3L).containsEntry("action", "PURGE").containsEntry("actor_id", owner.getId())
                .containsEntry("device_id", null).containsEntry("before_value", null)
                .containsEntry("after_value", null));
        client.get(path(tx)).assertProblem(404, "Not Found", "NOT_FOUND");
        purge(tx, "{\"version\":3}").assertProblem(404, "Not Found", "NOT_FOUND");
    }

    @Test
    void 휴지통에_없는_거래는_409_INVALID_STATE이고_version이_다르면_최신_거래가_든_409다() throws Exception {
        JsonNode live = create();
        UUID tx = id(live);

        purge(tx, "{\"version\":1}").assertProblem(409, "Conflict", "INVALID_STATE");
        JsonNode stale = purge(tx, "{\"version\":7}").assertProblem(409, "Conflict", "STALE_VERSION").json();
        assertThat(stale.get("current")).as("version을 상태보다 먼저 본다").isEqualTo(live);

        JsonNode inTrash = client.send("DELETE", path(tx) + "?version=1", null).json();
        for (String version : List.of("1", "3")) {
            JsonNode current = purge(tx, "{\"version\":" + version + "}")
                    .assertProblem(409, "Conflict", "STALE_VERSION").json().get("current");
            assertThat(current).as("휴지통이면 deletedAt이 있다").isEqualTo(inTrash);
        }

        assertThat(history(tx)).containsExactly("CREATE", "DELETE");
    }

    @Test
    void version의_형식이_틀리면_400이고_지우지_않는다() throws Exception {
        UUID tx = trashed();

        purge(tx, "{}").assertFieldErrors("version:REQUIRED");
        purge(tx, "{\"version\":null}").assertFieldErrors("version:REQUIRED");
        purge(tx, "{\"version\":\"2\"}").assertFieldErrors("version:INVALID_FORMAT");
        purge(tx, "{\"version\":2.0}").assertFieldErrors("version:INVALID_FORMAT");

        assertThat(history(tx)).containsExactly("CREATE", "DELETE");
    }

    /** 내가 구성원인 다른 장부의 거래, 남의 거래, 완전히 지운 거래, 없는 거래는 version이 틀려도 같은 404다. */
    @Test
    void 경로의_장부의_거래가_아니면_같은_404이고_지우지_않는다() throws Exception {
        User other = user();
        UUID shared = fixtures.personalLedgerId(other);
        ledgers.add(shared);
        fixtures.addMember(shared, owner, LedgerRole.MEMBER);
        UUID sharedCash = fixtures.account(other, shared, "같이쓰는현금", AccountType.CASH, 0, DAY).getId();
        UUID inShared = fixtures.delete(other, fixtures.expense(other, shared, sharedCash, null, DAY, 7_000)).id();
        User stranger = user();
        UUID strangers = fixtures.personalLedgerId(stranger);
        ledgers.add(strangers);
        UUID strangerCash = fixtures.account(stranger, strangers, "남의현금", AccountType.CASH, 0, DAY).getId();
        UUID ofStranger = fixtures.delete(stranger,
                fixtures.expense(stranger, strangers, strangerCash, null, DAY, 7_000)).id();
        UUID purged = trashed();
        fixtures.purge(purged, owner.getId());
        UUID missingId = UUID.randomUUID();
        Reply missing = purge(missingId, "{\"version\":2}");

        for (UUID target : List.of(inShared, ofStranger, purged, missingId)) {
            for (Reply reply : List.of(purge(target, "{\"version\":2}"), purge(target, "{}"))) {
                reply.assertProblem(404, "Not Found", "NOT_FOUND");
                assertThat(withoutRequestId(reply)).isEqualTo(withoutRequestId(missing));
            }
        }
        assertThat(jdbc.queryForList("select version from transaction where id in (?, ?)", Long.class, inShared,
                ofStranger)).containsExactly(2L, 2L);
    }

    /** 401 → 415 → 404다. 되살리기와 같다. */
    @Test
    void 인증과_Content_Type이_구성원_확인보다_먼저다() throws Exception {
        UUID tx = trashed();
        String path = path(tx) + "/purge";
        ServerClient outsider = ServerClient.signedIn(port, user().getId(), NOW);

        ServerClient.anonymous(port).postJson(path, "{\"version\":2}")
                .assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
        outsider.send("POST", path, "x", "Content-Type", "text/plain")
                .assertProblem(415, "Unsupported Media Type", "UNSUPPORTED_MEDIA_TYPE");
        outsider.postJson(path, "{\"version\":2}").assertProblem(404, "Not Found", "NOT_FOUND");
        client.send("POST", path, "{\"version\":2}", "Content-Type", "application/json", "Accept", "text/html")
                .assertProblem(400, "Bad Request", "MALFORMED_REQUEST");

        assertThat(history(tx)).containsExactly("CREATE", "DELETE");
    }

    // ---------------------------------------------------------------- 도우미

    private User user() {
        return fixtures.user(UUID.randomUUID().toString().substring(0, 18) + "@example.com");
    }

    /** 현금 계좌의 12,000원 지출을 만들고 응답의 거래를 돌려준다. */
    private JsonNode create() throws Exception {
        Reply created = client.postJson("/api/v1/ledgers/" + ledgerId + "/transactions", "{\"id\":\""
                + UUID.randomUUID() + "\",\"type\":\"EXPENSE\",\"occurredOn\":\"2026-11-18\",\"accountId\":\"" + cash
                + "\",\"amount\":12000,\"payee\":\"김밥천국\"}");
        assertThat(created.status()).as(created.body()).isEqualTo(201);
        return created.json();
    }

    /** 만들고(1) 휴지통에 넣은(2) 거래. */
    private UUID trashed() throws Exception {
        UUID tx = id(create());
        transactionService.delete(owner.getId(), tx, 1, "test-device");
        return tx;
    }

    private Reply purge(UUID tx, String json) throws Exception {
        return client.postJson(path(tx) + "/purge", json);
    }

    private String path(UUID id) {
        return "/api/v1/ledgers/" + ledgerId + "/transactions/" + id;
    }

    private long count(String sql, UUID id) {
        return jdbc.queryForObject(sql, Long.class, id);
    }

    /** 이력의 동작, version 순. */
    private List<String> history(UUID tx) {
        return jdbc.queryForList("select action from change_log where transaction_id = ? order by version",
                String.class, tx);
    }

    private static UUID id(JsonNode tx) {
        return UUID.fromString(tx.get("id").asString());
    }

    private static String withoutRequestId(Reply reply) {
        return reply.body().replace(reply.header("X-Request-Id"), "");
    }
}
