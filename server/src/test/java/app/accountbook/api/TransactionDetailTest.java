package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.account.AccountType;
import app.accountbook.api.ServerClient.Reply;
import app.accountbook.ledger.LedgerRole;
import app.accountbook.support.Fixtures;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.transaction.TransactionView;
import app.accountbook.user.User;
import java.time.Duration;
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
import tools.jackson.databind.json.JsonMapper;

/** {@code GET /api/v1/ledgers/{ledgerId}/transactions/{id}}(#15 상세 조회 계약). */
@LedgerApiTest
class TransactionDetailTest {

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
    void 상세는_만들기_응답과_같은_모양이다() throws Exception {
        UUID bank = fixtures.account(owner, ledgerId, "은행", AccountType.BANK, 0, DAY).getId();
        Reply expense = client.postJson(path(), "{\"id\":\"" + UUID.randomUUID() + "\",\"type\":\"EXPENSE\","
                + "\"occurredOn\":\"2026-11-18\",\"occurredTime\":\"08:05\",\"accountId\":\"" + cash + "\","
                + "\"amount\":12000,\"payee\":\"김밥천국\",\"memo\":\"점심\",\"refundKind\":\"REFUND\"}");
        Reply transfer = client.postJson(path(), "{\"id\":\"" + UUID.randomUUID() + "\",\"type\":\"TRANSFER\","
                + "\"occurredOn\":\"2026-11-18\",\"fromAccountId\":\"" + bank + "\",\"toAccountId\":\"" + cash + "\","
                + "\"amount\":50000}");

        for (Reply created : List.of(expense, transfer)) {
            assertThat(created.status()).as(created.body()).isEqualTo(201);
            Reply detail = client.get(path() + "/" + created.json().get("id").asString());
            assertThat(detail.status()).as(detail.body()).isEqualTo(200);
            assertThat(detail.header("Content-Type")).isEqualTo("application/json");
            assertThat(detail.json()).isEqualTo(created.json());
        }
    }

    @Test
    void 휴지통의_거래는_200이고_deletedAt과_purgeAt이_오며_취소한_거래는_CANCELED다() throws Exception {
        User member = user();
        fixtures.addMember(ledgerId, member, LedgerRole.MEMBER);
        TransactionView deleted = fixtures.delete(member, fixtures.expense(owner, ledgerId, cash, null, DAY, 7_000));
        TransactionView canceled = fixtures.cancel(member, fixtures.expense(owner, ledgerId, cash, null, DAY, 8_000));

        JsonNode trashed = detail(deleted.id());
        JsonNode cancel = detail(canceled.id());

        Instant deletedAt = Instant.parse(trashed.get("deletedAt").asString());
        assertThat(Instant.parse(trashed.get("purgeAt").asString())).isEqualTo(deletedAt.plus(Duration.ofDays(30)));
        assertThat(trashed.get("status").asString()).isEqualTo("POSTED");
        assertThat(trashed.get("version").asLong()).isEqualTo(2);
        assertThat(cancel.get("status").asString()).isEqualTo("CANCELED");
        assertThat(List.of(cancel.get("deletedAt"), cancel.get("purgeAt"))).allMatch(JsonNode::isNull);
        assertThat(List.of(trashed.get("createdBy"), cancel.get("createdBy"))).containsOnly(person(owner));
        assertThat(List.of(trashed.get("updatedBy"), cancel.get("updatedBy"))).containsOnly(person(member));
    }

    /** 내가 구성원인 다른 장부의 거래도 이 장부의 경로로는 없는 거래와 같다. 구성원이 아닌 장부는 경로부터 404다. */
    @Test
    void 없는_거래_다른_장부의_거래_완전히_지운_거래는_구분_없이_404다() throws Exception {
        User other = user();
        UUID otherLedger = fixtures.personalLedgerId(other);
        ledgers.add(otherLedger);
        fixtures.addMember(otherLedger, owner, LedgerRole.MEMBER);
        UUID otherCash = fixtures.account(other, otherLedger, "남의현금", AccountType.CASH, 0, DAY).getId();
        UUID othersTx = fixtures.expense(other, otherLedger, otherCash, null, DAY, 9_000).id();
        User stranger = user();
        UUID strangerLedger = fixtures.personalLedgerId(stranger);
        ledgers.add(strangerLedger);
        UUID strangerCash = fixtures.account(stranger, strangerLedger, "모르는현금", AccountType.CASH, 0, DAY).getId();
        UUID strangersTx = fixtures.expense(stranger, strangerLedger, strangerCash, null, DAY, 6_000).id();
        UUID purged = fixtures.expense(owner, ledgerId, cash, null, DAY, 1_000).id();
        fixtures.purge(purged, owner.getId());

        List<Reply> replies = new ArrayList<>();
        for (String id : List.of(UUID.randomUUID().toString(), othersTx.toString(), purged.toString(), "not-a-uuid")) {
            replies.add(client.get(path() + "/" + id));
        }
        replies.add(client.get("/api/v1/ledgers/" + strangerLedger + "/transactions/" + strangersTx));

        for (Reply reply : replies) {
            reply.assertProblem(404, "Not Found", "NOT_FOUND");
            assertThat(withoutRequestId(reply)).isEqualTo(withoutRequestId(replies.getFirst()))
                    .doesNotContain("9000", "남의현금", otherLedger.toString());
        }
        Reply own = client.get("/api/v1/ledgers/" + otherLedger + "/transactions/" + othersTx);
        assertThat(own.status()).as("대조: 그 거래의 장부 경로로는 보인다").isEqualTo(200);
    }

    private JsonNode detail(UUID id) throws Exception {
        Reply reply = client.get(path() + "/" + id);
        assertThat(reply.status()).as(reply.body()).isEqualTo(200);
        return reply.json();
    }

    private User user() {
        return fixtures.user(UUID.randomUUID().toString().substring(0, 18) + "@example.com");
    }

    private String path() {
        return "/api/v1/ledgers/" + ledgerId + "/transactions";
    }

    private static JsonNode person(User user) {
        return JSON.readTree("{\"id\":\"" + user.getId() + "\",\"displayName\":\"" + user.getDisplayName() + "\"}");
    }

    private static String withoutRequestId(Reply reply) {
        return reply.body().replace(reply.header("X-Request-Id"), "");
    }
}
