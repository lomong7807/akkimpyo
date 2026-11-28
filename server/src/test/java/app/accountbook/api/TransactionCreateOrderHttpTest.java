package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

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
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.stream.IntStream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 거래 만들기의 검사 순서(ADR 006 결정 4)와 서비스가 보는 범위·참조 오류(#14의 {@code fieldErrors})가 HTTP로 그대로 나가는지.
 * 순서 자체의 자세한 경우는 서비스의 {@code TransactionCreateOrderTest}가 본다. 동시 요청은 HTTP로 한 번만 본다.
 */
@LedgerApiTest
class TransactionCreateOrderHttpTest {

    /** 서울은 2026-11-27 12:00이다. 날짜의 끝은 서울의 오늘로부터 1년 뒤인 2027-11-27이다. */
    private static final Instant NOW = Instant.parse("2026-11-27T03:00:00Z");
    private static final LocalDate DAY = LocalDate.of(2026, 11, 18);

    @LocalServerPort int port;
    @Autowired StoppedClock clock;
    @Autowired Fixtures fixtures;
    @Autowired CategoryService categoryService;
    @Autowired JdbcTemplate jdbc;

    private UUID ledgerId;
    private UUID cash;
    private UUID bank;
    private UUID salary;
    private UUID othersCash;
    private ServerClient client;

    @BeforeEach
    void setUp() {
        clock.stopAt(NOW);
        User owner = fixtures.user(UUID.randomUUID().toString().substring(0, 18) + "@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
        cash = fixtures.account(owner, ledgerId, "현금", AccountType.CASH, 0, DAY).getId();
        bank = fixtures.account(owner, ledgerId, "은행", AccountType.BANK, 0, DAY).getId();
        salary = categoryService.create(owner.getId(), ledgerId,
                new CategoryCommand("급여", CategoryKind.INCOME, null)).getId();
        User other = fixtures.user(UUID.randomUUID().toString().substring(0, 18) + "@example.com");
        othersCash = fixtures.account(other, fixtures.personalLedgerId(other), "남의현금", AccountType.CASH, 0, DAY)
                .getId();
        client = ServerClient.signedIn(port, owner.getId(), NOW);
    }

    @AfterEach
    void removeTransactions() {
        jdbc.update("delete from change_log where ledger_id = ?", ledgerId);
        jdbc.update("delete from transaction where ledger_id = ?", ledgerId);
    }

    @Test
    void 범위와_참조의_오류는_그_입력란의_400이고_저장하지_않는다() throws Exception {
        create(expense(UUID.randomUUID(), cash, "0", "2026-11-18", "null")).assertFieldErrors("amount:OUT_OF_RANGE");
        create(expense(UUID.randomUUID(), cash, "10000000000", "2026-11-18", "null"))
                .assertFieldErrors("amount:OUT_OF_RANGE");
        create(expense(UUID.randomUUID(), cash, "1000", "1999-12-31", "null"))
                .assertFieldErrors("occurredOn:OUT_OF_RANGE");
        create(expense(UUID.randomUUID(), cash, "1000", "2027-11-28", "null"))
                .assertFieldErrors("occurredOn:OUT_OF_RANGE");
        create(expense(UUID.randomUUID(), cash, "1000", "2026-11-18", quoted("가".repeat(101))))
                .assertFieldErrors("payee:TOO_LONG");
        create(expense(UUID.randomUUID(), othersCash, "1000", "2026-11-18", "null"))
                .assertFieldErrors("accountId:NOT_FOUND");
        create(expense(UUID.randomUUID(), UUID.randomUUID(), "1000", "2026-11-18", "null"))
                .assertFieldErrors("accountId:NOT_FOUND");
        create(expense(UUID.randomUUID(), cash, "1000", "2026-11-18", "null").replace("}",
                ",\"categoryId\":\"" + salary + "\"}")).assertFieldErrors("categoryId:NOT_ALLOWED");
        create(expense(UUID.randomUUID(), cash, "1000", "2026-11-18", "null").replace("}",
                ",\"categoryId\":\"" + UUID.randomUUID() + "\"}")).assertFieldErrors("categoryId:NOT_FOUND");
        create(transfer(UUID.randomUUID(), cash, cash)).assertFieldErrors("toAccountId:NOT_ALLOWED");
        create(transfer(UUID.randomUUID(), cash, othersCash)).assertFieldErrors("toAccountId:NOT_FOUND");
        create(transfer(UUID.randomUUID(), othersCash, cash)).assertFieldErrors("fromAccountId:NOT_FOUND");

        assertThat(storedCount()).isZero();
    }

    @Test
    void 형식_오류는_같은_id가_있어도_재전송이나_충돌이_아니라_400이다() throws Exception {
        UUID id = UUID.randomUUID();
        String saved = expense(id, cash, "1000", "2026-11-18", "null");
        assertThat(create(saved).status()).isEqualTo(201);

        create(expense(id, cash, "0", "2026-11-18", "null")).assertFieldErrors("amount:OUT_OF_RANGE");
        create(expense(id, cash, "1000", "2026-11-18", quoted("가".repeat(101)))).assertFieldErrors("payee:TOO_LONG");
        client.send("POST", path(), saved, "Content-Type", "application/json", "X-Akkimpyo-Device", "a b")
                .assertFieldErrors("X-Akkimpyo-Device:INVALID_FORMAT");
        create(saved.replace("\"amount\":1000", "\"amount\":\"1000\"")).assertFieldErrors("amount:INVALID_FORMAT");

        assertThat(storedCount()).isEqualTo(1);
    }

    @Test
    void 같은_id의_판정이_참조_검증보다_먼저다() throws Exception {
        UUID id = UUID.randomUUID();
        Reply first = create(expense(id, cash, "1000", "2026-11-18", "null"));

        // 남의 계좌라 새 거래면 참조 오류지만, 같은 id의 다른 내용으로 먼저 판정된다.
        Reply conflict = create(expense(id, othersCash, "1000", "2026-11-18", "null"));

        conflict.assertProblem(409, "Conflict", "ID_CONFLICT");
        assertThat(conflict.json().get("current")).isEqualTo(first.json());
        create(expense(UUID.randomUUID(), othersCash, "1000", "2026-11-18", "null"))
                .assertFieldErrors("accountId:NOT_FOUND");
    }

    /** ADR 006 결정 3: 한 건만 만들어지고 나머지는 재전송 200이다. 500이 아니다. 반복 확인은 CI가 한다. */
    @Test
    void 같은_id를_동시에_보내도_한_건만_만들어지고_나머지는_200이다() throws Exception {
        int requests = 4;
        String body = expense(UUID.randomUUID(), cash, "1000", "2026-11-18", "null");
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(requests);
        List<Reply> replies;
        try {
            Callable<Reply> send = () -> {
                start.await();
                return create(body);
            };
            List<Future<Reply>> sent = IntStream.range(0, requests).mapToObj(i -> pool.submit(send)).toList();
            start.countDown();
            replies = sent.stream().map(TransactionCreateOrderHttpTest::await).toList();
        } finally {
            pool.shutdownNow();
        }

        assertThat(replies).extracting(Reply::status).as(replies.toString())
                .containsExactlyInAnyOrder(201, 200, 200, 200);
        assertThat(replies).extracting(Reply::json).containsOnly(replies.getFirst().json());
        assertThat(storedCount()).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from change_log where ledger_id = ?", Long.class, ledgerId))
                .isEqualTo(1);
    }

    private Reply create(String json) throws Exception {
        return client.send("POST", path(), json, "Content-Type", "application/json", "Accept", "application/json");
    }

    private static Reply await(Future<Reply> reply) {
        try {
            return reply.get();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private long storedCount() {
        return jdbc.queryForObject("select count(*) from transaction where ledger_id = ?", Long.class, ledgerId);
    }

    private String path() {
        return "/api/v1/ledgers/" + ledgerId + "/transactions";
    }

    /** @param payee JSON 글자 그대로 */
    private static String expense(UUID id, UUID account, String amount, String on, String payee) {
        return "{\"id\":\"" + id + "\",\"type\":\"EXPENSE\",\"occurredOn\":\"" + on + "\",\"accountId\":\"" + account
                + "\",\"amount\":" + amount + ",\"payee\":" + payee + "}";
    }

    private static String transfer(UUID id, UUID from, UUID to) {
        return "{\"id\":\"" + id + "\",\"type\":\"TRANSFER\",\"occurredOn\":\"2026-11-18\",\"fromAccountId\":\"" + from
                + "\",\"toAccountId\":\"" + to + "\",\"amount\":1000}";
    }

    private static String quoted(String text) {
        return "\"" + text + "\"";
    }
}
