package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.account.AccountType;
import app.accountbook.api.ServerClient.Reply;
import app.accountbook.category.CategoryCommand;
import app.accountbook.category.CategoryKind;
import app.accountbook.category.CategoryService;
import app.accountbook.support.Fixtures;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.transaction.TransactionCommand.Entry;
import app.accountbook.transaction.TransactionCommand.Transfer;
import app.accountbook.transaction.TransactionService;
import app.accountbook.transaction.TransactionType;
import app.accountbook.user.User;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * {@code GET .../exports}(#57 요청 계약)의 HTTP 쪽: CSV 본문과 헤더, 204, 쿼리 오류, 404와 401. 기간 경계와 휴지통·취소는
 * {@code TransactionExportQueryTest}가, BOM의 바이트와 따옴표는 {@code CsvExportTest}가 본다.
 */
@LedgerApiTest
class ExportTest {

    private static final Instant NOW = Instant.parse("2026-11-27T03:00:00Z");
    private static final LocalDate OCT_1 = LocalDate.of(2026, 10, 1);
    private static final String OCTOBER = "?format=csv&from=2026-10-01&to=2026-10-31";

    @LocalServerPort int port;
    @Autowired StoppedClock clock;
    @Autowired Fixtures fixtures;
    @Autowired TransactionService transactionService;
    @Autowired CategoryService categoryService;
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
        cash = fixtures.account(owner, ledgerId, "현금", AccountType.CASH, 0, OCT_1).getId();
        client = ServerClient.signedIn(port, owner.getId(), NOW);
    }

    /** HTTP 테스트는 롤백되지 않는다. 거래는 이 장부에만 만든다. */
    @AfterEach
    void removeTransactions() {
        jdbc.update("delete from change_log where ledger_id = ?", ledgerId);
        jdbc.update("delete from transaction where ledger_id = ?", ledgerId);
    }

    @Test
    void 본문은_BOM이_붙은_CSV이고_F701의_열을_오래된_거래부터_쓴다() throws Exception {
        UUID bank = fixtures.account(owner, ledgerId, "은행", AccountType.BANK, 0, OCT_1).getId();
        UUID spare = fixtures.account(owner, ledgerId, "-비상금", AccountType.CASH, 0, OCT_1).getId();
        UUID food = category("식비", CategoryKind.EXPENSE, null);
        UUID lunch = category("점심", CategoryKind.EXPENSE, food);
        UUID salary = category("급여", CategoryKind.INCOME, null);
        entry(TransactionType.EXPENSE, 1, LocalTime.MIDNIGHT, cash, lunch, 16_500, false, "올래국수", "회식, 2차");
        entry(TransactionType.EXPENSE, 2, null, cash, food, 3_000, true, "올래국수", null);
        entry(TransactionType.INCOME, 3, LocalTime.of(9, 0), bank, salary, 3_200_000, false, "회사", null);
        transactionService.create(owner.getId(), ledgerId, new Transfer(UUID.randomUUID(), OCT_1.withDayOfMonth(4),
                LocalTime.of(8, 0), bank, cash, 50_000, "용돈"), "test-device");
        fixtures.cancel(owner, fixtures.expense(owner, ledgerId, cash, null, OCT_1.withDayOfMonth(5), 7_000));
        fixtures.delete(owner, fixtures.expense(owner, ledgerId, cash, food, OCT_1.withDayOfMonth(6), 8_000));
        entry(TransactionType.EXPENSE, 31, LocalTime.of(23, 59), spare, food, 1_000, false, "=HYPERLINK(\"x\")",
                "@SUM(A1)");
        String me = owner.getDisplayName();

        Reply reply = client.get(path() + OCTOBER);

        assertThat(reply.status()).as(reply.body()).isEqualTo(200);
        assertThat(MediaType.parseMediaType(reply.header("Content-Type")))
                .isEqualTo(MediaType.parseMediaType("text/csv; charset=UTF-8"));
        assertThat(reply.header("Cache-Control")).isEqualTo("no-store");
        assertThat(reply.header("Content-Disposition")).isEqualTo("attachment; "
                + "filename=\"_ ____20261001_20261031.csv\"; "
                + "filename*=UTF-8''%EB%82%B4%20%EA%B0%80%EA%B3%84%EB%B6%80_20261001_20261031.csv");
        assertThat(reply.body()).isEqualTo("\uFEFF날짜,시각,유형,금액,환불·돌려받음 구분,계좌,받는 계좌,상위 카테고리,"
                + "하위 카테고리,가맹점/내용,메모,결제한 사람,상태,미확인 여부,이벤트,작성자,거래 번호\r\n"
                + "2026-10-01,00:00,지출,16500,,현금,,식비,점심,올래국수,\"회식, 2차\",,완료,,," + me + ",1\r\n"
                + "2026-10-02,,지출,3000,환불,현금,,식비,,올래국수,,,완료,,," + me + ",2\r\n"
                + "2026-10-03,09:00,수입,3200000,,은행,,급여,,회사,,,완료,,," + me + ",3\r\n"
                + "2026-10-04,08:00,이체,50000,,은행,현금,,,,용돈,,완료,,," + me + ",4\r\n"
                + "2026-10-05,,지출,7000,,현금,,미분류,,,,,취소,,," + me + ",5\r\n"
                + "2026-10-31,23:59,지출,1000,,'-비상금,,식비,,\"'=HYPERLINK(\"\"x\"\")\",'@SUM(A1),,완료,,," + me
                + ",6\r\n");
    }

    @Test
    void 내보낼_거래가_없거나_휴지통_거래뿐이면_본문_없는_204다() throws Exception {
        assertNoContent(client.get(path() + OCTOBER));

        fixtures.delete(owner, fixtures.expense(owner, ledgerId, cash, null, OCT_1.withDayOfMonth(15), 1_000));
        fixtures.expense(owner, ledgerId, cash, null, LocalDate.of(2026, 11, 1), 1_000);
        assertNoContent(client.get(path() + OCTOBER));
    }

    /** 오류는 Accept와 무관하게 problem+json이다. 엑셀(xlsx)은 다음 PR에서 연다. */
    @Test
    void format_from_to가_없거나_형식이_틀리거나_종료일이_앞서면_그_입력란의_400이다() throws Exception {
        Map<String, String[]> rejected = Map.ofEntries(
                Map.entry("", new String[] {"format:REQUIRED", "from:REQUIRED", "to:REQUIRED"}),
                Map.entry("from=2026-10-01&to=2026-10-31", new String[] {"format:REQUIRED"}),
                Map.entry("format=xlsx&from=2026-10-01&to=2026-10-31", new String[] {"format:INVALID_FORMAT"}),
                Map.entry("format=CSV&from=2026-10-01&to=2026-10-31", new String[] {"format:INVALID_FORMAT"}),
                Map.entry("format=csv&to=2026-10-31", new String[] {"from:REQUIRED"}),
                Map.entry("format=csv&from=2026-10-01", new String[] {"to:REQUIRED"}),
                Map.entry("format=csv&from=2026-02-29&to=2026-10-31", new String[] {"from:INVALID_FORMAT"}),
                Map.entry("format=csv&from=&to=", new String[] {"from:INVALID_FORMAT", "to:INVALID_FORMAT"}),
                Map.entry("format=csv&from=2026-10-01&to=2026-10-31&to=2026-11-30", new String[] {"to:INVALID_FORMAT"}),
                Map.entry("format=csv&from=0000-12-31&to=2026-10-31", new String[] {"from:OUT_OF_RANGE"}),
                Map.entry("format=csv&from=2026-10-01&to=0000-01-01", new String[] {"to:OUT_OF_RANGE"}),
                Map.entry("format=csv&from=2026-10-31&to=2026-10-30", new String[] {"to:NOT_ALLOWED"}));
        for (Map.Entry<String, String[]> query : rejected.entrySet()) {
            client.get(path() + "?" + query.getKey(), "Accept", "text/csv").assertFieldErrors(query.getValue());
        }
        assertNoContent(client.get(path() + "?format=csv&from=0001-01-01&to=9999-12-31", "Accept", "application/json"));
    }

    @Test
    void 구성원이_아닌_장부는_쿼리가_틀려도_404이고_토큰이_없으면_401이다() throws Exception {
        String stranger = "/api/v1/ledgers/" + fixtures.personalLedgerId(user()) + "/exports";

        client.get(stranger + OCTOBER).assertProblem(404, "Not Found", "NOT_FOUND");
        client.get(stranger + "?format=xlsx&from=bad").assertProblem(404, "Not Found", "NOT_FOUND");
        ServerClient.anonymous(port).get(path() + OCTOBER).assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
    }

    private void entry(TransactionType type, int october, LocalTime at, UUID account, UUID category, long amount,
                       boolean refund, String payee, String memo) {
        transactionService.create(owner.getId(), ledgerId, new Entry(UUID.randomUUID(), type,
                OCT_1.withDayOfMonth(october), at, account, category, amount, refund, payee, memo, null), "test-device");
    }

    private UUID category(String name, CategoryKind kind, UUID parentId) {
        return categoryService.create(owner.getId(), ledgerId, new CategoryCommand(name, kind, parentId)).getId();
    }

    private static void assertNoContent(Reply reply) {
        assertThat(reply.status()).as(reply.body()).isEqualTo(204);
        assertThat(reply.body()).isEmpty();
        assertThat(reply.header("Content-Disposition")).isNull();
        assertThat(reply.header("Cache-Control")).isEqualTo("no-store");
    }

    private User user() {
        return fixtures.user(UUID.randomUUID().toString().substring(0, 18) + "@example.com");
    }

    private String path() {
        return "/api/v1/ledgers/" + ledgerId + "/exports";
    }
}
