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
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * {@code DELETE /api/v1/ledgers/{ledgerId}/accounts/{accountId}}(#43, F-508). 거래가 하나도 없는 계좌만 지우고 204다.
 * 거래가 있으면(휴지통·취소한 거래, 이체의 받는 쪽 포함) 409 {@code ACCOUNT_HAS_TRANSACTIONS}이다(P-220).
 */
@LedgerApiTest
class AccountDeleteTest {

    private static final LocalDate OPENING = LocalDate.of(2026, 11, 1);
    private static final LocalDate DAY = LocalDate.of(2026, 11, 18);

    @LocalServerPort int port;
    @Autowired StoppedClock clock;
    @Autowired Fixtures fixtures;
    @Autowired JdbcTemplate jdbc;

    private User owner;
    private UUID ledgerId;
    private UUID cash;
    private ServerClient client;

    @BeforeEach
    void setUp() {
        clock.stopAt(NOW);
        owner = user();
        ledgerId = fixtures.personalLedgerId(owner);
        cash = fixtures.account(owner, ledgerId, "비상금", AccountType.CASH, 0, OPENING).getId();
        client = ServerClient.signedIn(port, owner.getId(), NOW);
    }

    /** HTTP 테스트는 롤백되지 않는다. 거래 수를 DB 전체로 세는 테스트(TransactionServiceTest 등)가 있어 만든 거래를 지운다. */
    @AfterEach
    void removeTransactions() {
        jdbc.update("delete from change_log where ledger_id = ?", ledgerId);
        jdbc.update("delete from transaction where ledger_id = ?", ledgerId);
    }

    @Test
    void 거래가_없으면_204이고_목록에서_빠지며_다시_지우면_404다() throws Exception {
        UUID hidden = fixtures.account(owner, ledgerId, "숨긴계좌", AccountType.BANK, 5_000, OPENING).getId();
        client.send("PUT", path() + "/" + hidden + "/visibility", "{\"hidden\":true}",
                "Content-Type", "application/json");

        Reply deleted = delete(cash);

        assertThat(deleted.status()).as(deleted.body()).isEqualTo(204);
        assertThat(deleted.body()).isEmpty();
        assertThat(delete(hidden).status()).as("숨긴 계좌도 거래가 없으면 지운다").isEqualTo(204);
        assertThat(client.get(path()).json().get("items").isEmpty()).isTrue();
        assertThat(exists(cash)).isFalse();
        delete(cash).assertProblem(404, "Not Found", "NOT_FOUND");
    }

    @Test
    void 거래가_있으면_409이고_지우지_않는다() throws Exception {
        UUID bank = account("월급통장");
        Map<String, UUID> used = Map.of(
                "지출", account("지출계좌"),
                "휴지통의 거래", account("휴지통계좌"),
                "취소한 거래", account("취소계좌"),
                "이체의 보내는 쪽", account("보내는계좌"),
                "이체의 받는 쪽", account("받는계좌"));
        fixtures.expense(owner, ledgerId, used.get("지출"), null, DAY, 1_000);
        fixtures.delete(owner, fixtures.expense(owner, ledgerId, used.get("휴지통의 거래"), null, DAY, 2_000));
        fixtures.cancel(owner, fixtures.expense(owner, ledgerId, used.get("취소한 거래"), null, DAY, 3_000));
        fixtures.transfer(owner, ledgerId, used.get("이체의 보내는 쪽"), bank, DAY, 4_000);
        fixtures.transfer(owner, ledgerId, bank, used.get("이체의 받는 쪽"), DAY, 5_000);

        for (Map.Entry<String, UUID> account : used.entrySet()) {
            Reply reply = delete(account.getValue());

            reply.assertProblem(409, "Conflict", "ACCOUNT_HAS_TRANSACTIONS");
            assertThat(exists(account.getValue())).as(account.getKey()).isTrue();
        }
    }

    /** 내가 구성원인 다른 장부의 계좌, 남의 계좌, 없는 계좌, 형식이 틀린 id는 같은 404이고 지우지 않는다. */
    @Test
    void 경로의_장부의_계좌가_아니면_같은_404다() throws Exception {
        User other = user();
        UUID shared = fixtures.personalLedgerId(other);
        fixtures.addMember(shared, owner, LedgerRole.MEMBER);
        UUID sharedCash = fixtures.account(other, shared, "같이쓰는현금", AccountType.CASH, 0, OPENING).getId();
        User stranger = user();
        UUID strangerCash = fixtures.account(stranger, fixtures.personalLedgerId(stranger), "남의현금",
                AccountType.CASH, 0, OPENING).getId();
        Reply missing = delete(UUID.randomUUID());

        for (Object target : List.of(sharedCash, strangerCash, "x")) {
            Reply reply = delete(target).assertProblem(404, "Not Found", "NOT_FOUND");
            assertThat(withoutRequestId(reply)).as(String.valueOf(target)).isEqualTo(withoutRequestId(missing));
        }
        assertThat(List.of(exists(sharedCash), exists(strangerCash))).containsExactly(true, true);
        // 대조: 그 계좌의 장부 경로로는 지워진다.
        assertThat(client.send("DELETE", "/api/v1/ledgers/" + shared + "/accounts/" + sharedCash, null).status())
                .isEqualTo(204);
    }

    /** 401 → 404다. 응답할 수 없는 {@code Accept}는 지우기 전에 거절한다(ADR 002 5절). */
    @Test
    void 인증이_구성원_확인보다_먼저이고_받을_수_없는_요청은_지우기_전에_거절한다() throws Exception {
        String path = path() + "/" + cash;

        ServerClient.anonymous(port).send("DELETE", path, null).assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
        ServerClient.signedIn(port, user().getId(), NOW).send("DELETE", path, null)
                .assertProblem(404, "Not Found", "NOT_FOUND");
        client.send("DELETE", path, null, "Accept", "text/html")
                .assertProblem(400, "Bad Request", "MALFORMED_REQUEST");

        assertThat(exists(cash)).isTrue();
    }

    // ---------------------------------------------------------------- 도우미

    private UUID account(String name) {
        return fixtures.account(owner, ledgerId, name, AccountType.BANK, 0, OPENING).getId();
    }

    private Reply delete(Object accountId) throws Exception {
        return client.send("DELETE", path() + "/" + accountId, null, "Accept", "application/json");
    }

    private boolean exists(UUID accountId) {
        return Boolean.TRUE.equals(jdbc.queryForObject("select exists(select 1 from account where id = ?)",
                Boolean.class, accountId));
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
