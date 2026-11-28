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
import app.accountbook.transaction.TransactionView;
import app.accountbook.user.User;
import java.time.Instant;
import java.time.LocalDate;
import java.util.LinkedHashMap;
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
 * 카테고리 삭제의 영향 조회 {@code GET .../categories/{categoryId}/deletion-impact}와 삭제
 * {@code DELETE .../categories/{categoryId}?targetCategoryId=}(#35, F-512, P-222). 옮기기와 옮길 곳의 규칙은 서비스(#3)가
 * 정하고 {@code transaction.CategoryDeleteTest}가 본다. 여기서는 요청과 응답, 검사 순서를 본다.
 */
@LedgerApiTest
class CategoryDeleteHttpTest {

    private static final Instant NOW = Instant.parse("2026-11-27T03:00:00Z");
    private static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    private static final String DEVICE_HEADER = "X-Akkimpyo-Device";

    @LocalServerPort int port;
    @Autowired StoppedClock clock;
    @Autowired Fixtures fixtures;
    @Autowired CategoryService categoryService;
    @Autowired JdbcTemplate jdbc;

    private User owner;
    private UUID ledgerId;
    private ServerClient client;
    private UUID food;
    private UUID lunch;
    private UUID snack;
    private UUID leisure;
    private UUID salary;
    private UUID uncategorized;
    /** 식비의 지출, 점심의 휴지통에 넣은 지출, 점심의 취소한 지출. 식비를 지우면 옮겨진다. */
    private List<TransactionView> affected;
    private TransactionView untouched;

    @BeforeEach
    void setUp() {
        clock.stopAt(NOW);
        owner = user();
        ledgerId = fixtures.personalLedgerId(owner);
        client = ServerClient.signedIn(port, owner.getId(), NOW);
        UUID cash = fixtures.account(owner, ledgerId, "현금", AccountType.CASH, 0, DAY).getId();
        food = create(owner, ledgerId, "식비", CategoryKind.EXPENSE, null);
        lunch = create(owner, ledgerId, "점심", CategoryKind.EXPENSE, food);
        snack = create(owner, ledgerId, "간식", CategoryKind.EXPENSE, food);
        leisure = create(owner, ledgerId, "여가", CategoryKind.EXPENSE, null);
        salary = create(owner, ledgerId, "급여", CategoryKind.INCOME, null);
        uncategorized = categoryService.uncategorized(ledgerId, CategoryKind.EXPENSE).getId();
        affected = List.of(fixtures.expense(owner, ledgerId, cash, food, DAY, 12_000),
                fixtures.delete(owner, fixtures.expense(owner, ledgerId, cash, lunch, DAY, 8_000)),
                fixtures.cancel(owner, fixtures.expense(owner, ledgerId, cash, lunch, DAY, 9_000)));
        untouched = fixtures.expense(owner, ledgerId, cash, leisure, DAY, 30_000);
    }

    /** HTTP 테스트는 롤백되지 않는다. 거래 수를 DB 전체로 세는 테스트(TransactionServiceTest 등)가 있어 만든 거래를 지운다. */
    @AfterEach
    void removeTransactions() {
        jdbc.update("delete from change_log where ledger_id = ?", ledgerId);
        jdbc.update("delete from transaction where ledger_id = ?", ledgerId);
    }

    @Test
    void 영향_조회는_하위와_휴지통과_취소한_거래를_센_거래_수와_함께_지워질_하위_수다() throws Exception {
        Reply reply = client.get(path() + "/" + food + "/deletion-impact");

        assertThat(reply.status()).as(reply.body()).isEqualTo(200);
        assertThat(reply.header("Content-Type")).isEqualTo("application/json");
        assertThat(reply.json().propertyNames()).containsExactlyInAnyOrder("transactionCount", "childCount");
        assertThat(reply.json().get("transactionCount").asLong()).isEqualTo(3);
        assertThat(reply.json().get("childCount").asLong()).isEqualTo(2);
        Reply child = client.get(path() + "/" + lunch + "/deletion-impact");
        assertThat(List.of(child.json().get("transactionCount").asLong(), child.json().get("childCount").asLong()))
                .containsExactly(2L, 0L);
        client.get(path() + "/" + uncategorized + "/deletion-impact").assertProblem(409, "Conflict", "INVALID_STATE");
    }

    @Test
    void 옮길_곳이_없으면_같은_구분의_미분류로_옮기고_하위도_지우며_204다() throws Exception {
        Reply deleted = delete(food, "", DEVICE_HEADER, "iphone.safari");

        assertThat(deleted.status()).as(deleted.body()).isEqualTo(204);
        assertThat(deleted.body()).isEmpty();
        assertThat(List.of(exists(food), exists(lunch), exists(snack))).containsOnly(false);
        for (TransactionView tx : affected) {
            assertThat(lineCategories(tx)).containsOnly(uncategorized);
            assertThat(moves(tx)).as("옮긴 이력의 기기 값").containsExactly("iphone.safari");
        }
        assertThat(lineCategories(untouched)).containsOnly(leisure);
        delete(food, "").assertProblem(404, "Not Found", "NOT_FOUND");
    }

    @Test
    void 옮길_곳을_고르면_그리로_옮기고_기기_헤더가_없으면_unknown이다() throws Exception {
        Reply deleted = delete(food, "?targetCategoryId=" + leisure);

        assertThat(deleted.status()).as(deleted.body()).isEqualTo(204);
        for (TransactionView tx : affected) {
            assertThat(lineCategories(tx)).containsOnly(leisure);
            assertThat(moves(tx)).containsExactly("unknown");
        }
        assertThat(exists(leisure)).isTrue();
    }

    /** 옮길 곳 오류는 서비스(#3)의 것 그대로이고, UUID가 아닌 값은 여기서 형식 오류다. 아무것도 바꾸지 않는다. */
    @Test
    void 옮길_곳이_틀리면_그_이유로_400이고_지우지_않는다() throws Exception {
        User stranger = user();
        UUID strangers = create(stranger, fixtures.personalLedgerId(stranger), "남의식비", CategoryKind.EXPENSE, null);
        UUID removed = create(owner, ledgerId, "지운분류", CategoryKind.EXPENSE, null);
        categoryService.delete(owner.getId(), ledgerId, removed, null, null);
        Map<String, String> cases = new LinkedHashMap<>();
        cases.put("=" + food, "NOT_ALLOWED");
        cases.put("=" + lunch, "NOT_ALLOWED");
        cases.put("=" + salary, "KIND_MISMATCH");
        cases.put("=" + categoryService.uncategorized(ledgerId, CategoryKind.INCOME).getId(), "KIND_MISMATCH");
        cases.put("=" + strangers, "NOT_FOUND");
        cases.put("=" + removed, "NOT_FOUND");
        cases.put("=" + UUID.randomUUID(), "NOT_FOUND");
        cases.put("=abc", "INVALID_FORMAT");
        cases.put("=", "INVALID_FORMAT");
        cases.put("=" + leisure + "&targetCategoryId=" + leisure, "INVALID_FORMAT");

        for (Map.Entry<String, String> target : cases.entrySet()) {
            delete(food, "?targetCategoryId" + target.getKey()).assertFieldErrors("targetCategoryId:" + target.getValue());
        }
        assertThat(List.of(exists(food), exists(lunch), exists(snack))).containsOnly(true);
        assertThat(lineCategories(affected.getFirst())).containsOnly(food);
        assertThat(moves(affected.getFirst())).isEmpty();
    }

    /**
     * 미분류는 409다. 기기 값과 옮길 곳의 형식은 상태와 옮길 곳 검사보다 먼저고 둘 다 틀리면 함께 알린다(PR #370 architect 후속,
     * ADR 002 5절).
     */
    @Test
    void 미분류는_409이고_형식_오류가_상태와_옮길_곳보다_먼저다() throws Exception {
        delete(uncategorized, "").assertProblem(409, "Conflict", "INVALID_STATE");
        delete(uncategorized, "", DEVICE_HEADER, "a b").assertFieldErrors(DEVICE_HEADER + ":INVALID_FORMAT");
        delete(uncategorized, "?targetCategoryId=x").assertFieldErrors("targetCategoryId:INVALID_FORMAT");
        delete(food, "?targetCategoryId=" + food, DEVICE_HEADER, "a b")
                .assertFieldErrors(DEVICE_HEADER + ":INVALID_FORMAT");
        delete(food, "?targetCategoryId=x", DEVICE_HEADER, "a b")
                .assertFieldErrors("targetCategoryId:INVALID_FORMAT", DEVICE_HEADER + ":INVALID_FORMAT");

        assertThat(List.of(exists(uncategorized), exists(food))).containsOnly(true);
        assertThat(moves(affected.getFirst())).isEmpty();
    }

    /** 내가 구성원인 다른 장부의 것, 남의 것, 지운 것, 형식이 틀린 id는 쿼리와 헤더가 틀려도 없는 id와 같은 404이고 지우지 않는다. */
    @Test
    void 경로의_장부의_카테고리가_아니면_같은_404다() throws Exception {
        User other = user();
        UUID shared = fixtures.personalLedgerId(other);
        fixtures.addMember(shared, owner, LedgerRole.MEMBER);
        UUID sharedFood = create(other, shared, "같이쓰는식비", CategoryKind.EXPENSE, null);
        User stranger = user();
        UUID strangers = create(stranger, fixtures.personalLedgerId(stranger), "남의식비", CategoryKind.EXPENSE, null);
        UUID removed = create(owner, ledgerId, "지운분류", CategoryKind.EXPENSE, null);
        categoryService.delete(owner.getId(), ledgerId, removed, null, null);
        UUID missingId = UUID.randomUUID();
        Reply missing = delete(missingId, "");

        for (Object target : List.of(sharedFood, strangers, removed, missingId, "x")) {
            for (Reply reply : List.of(client.get(path() + "/" + target + "/deletion-impact"), delete(target, ""),
                    delete(target, "?targetCategoryId=" + leisure), delete(target, "?targetCategoryId=x"),
                    delete(target, "", DEVICE_HEADER, "a b"))) {
                reply.assertProblem(404, "Not Found", "NOT_FOUND");
                assertThat(withoutRequestId(reply)).as(String.valueOf(target)).isEqualTo(withoutRequestId(missing));
            }
        }
        assertThat(List.of(exists(sharedFood), exists(strangers))).containsOnly(true);
        // 대조: 그 카테고리의 장부 경로로는 지워진다. 구성원이면 소유자가 아니어도 된다.
        assertThat(client.send("DELETE", "/api/v1/ledgers/" + shared + "/categories/" + sharedFood, null).status())
                .isEqualTo(204);
    }

    /** 401 → 404(구성원 확인은 쿼리와 헤더를 읽기 전) 순서다. 응답할 수 없는 {@code Accept}는 지우기 전에 거절한다(ADR 002 5절). */
    @Test
    void 인증이_구성원_확인보다_먼저이고_받을_수_없는_요청은_지우기_전에_거절한다() throws Exception {
        String impact = path() + "/" + food + "/deletion-impact";
        String target = path() + "/" + food + "?targetCategoryId=x";
        ServerClient outsider = ServerClient.signedIn(port, user().getId(), NOW);

        ServerClient.anonymous(port).get(impact).assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
        ServerClient.anonymous(port).send("DELETE", target, null)
                .assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
        outsider.get(impact).assertProblem(404, "Not Found", "NOT_FOUND");
        outsider.send("DELETE", target, null, DEVICE_HEADER, "a b").assertProblem(404, "Not Found", "NOT_FOUND");
        client.get(impact, "Accept", "text/html").assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
        client.send("DELETE", path() + "/" + food, null, "Accept", "text/html")
                .assertProblem(400, "Bad Request", "MALFORMED_REQUEST");

        assertThat(exists(food)).isTrue();
    }

    // ---------------------------------------------------------------- 도우미

    private Reply delete(Object categoryId, String query, String... headers) throws Exception {
        String[] all = new String[headers.length + 2];
        all[0] = "Accept";
        all[1] = "application/json";
        System.arraycopy(headers, 0, all, 2, headers.length);
        return client.send("DELETE", path() + "/" + categoryId + query, null, all);
    }

    private UUID create(User actor, UUID ledger, String name, CategoryKind kind, UUID parentId) {
        return categoryService.create(actor.getId(), ledger, new CategoryCommand(name, kind, parentId)).getId();
    }

    private boolean exists(UUID categoryId) {
        return Boolean.TRUE.equals(jdbc.queryForObject("select exists(select 1 from category where id = ?)",
                Boolean.class, categoryId));
    }

    private List<UUID> lineCategories(TransactionView tx) {
        return jdbc.queryForList("select category_id from transaction_line where transaction_id = ?", UUID.class,
                tx.id());
    }

    /** 카테고리 이동 이력의 기기 값. */
    private List<String> moves(TransactionView tx) {
        return jdbc.queryForList(
                "select device_id from change_log where transaction_id = ? and action = 'CATEGORY_MOVE'",
                String.class, tx.id());
    }

    private User user() {
        return fixtures.user(UUID.randomUUID().toString().substring(0, 18) + "@example.com");
    }

    private String path() {
        return "/api/v1/ledgers/" + ledgerId + "/categories";
    }

    private static String withoutRequestId(Reply reply) {
        return reply.body().replace(reply.header("X-Request-Id"), "");
    }
}
