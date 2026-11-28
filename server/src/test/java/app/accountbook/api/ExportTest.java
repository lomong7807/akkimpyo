package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.account.AccountType;
import app.accountbook.api.ServerClient.Reply;
import app.accountbook.category.CategoryCommand;
import app.accountbook.category.CategoryKind;
import app.accountbook.category.CategoryService;
import app.accountbook.support.Fixtures;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.support.TestAccessTokens;
import app.accountbook.transaction.RefundKind;
import app.accountbook.transaction.TransactionCommand.Entry;
import app.accountbook.transaction.TransactionCommand.Transfer;
import app.accountbook.transaction.TransactionService;
import app.accountbook.transaction.TransactionType;
import app.accountbook.user.User;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
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
        entry(TransactionType.EXPENSE, 1, LocalTime.MIDNIGHT, cash, lunch, 16_500, null, "올래국수", "회식, 2차");
        entry(TransactionType.EXPENSE, 2, null, cash, food, 3_000, RefundKind.REFUND, "올래국수", null);
        entry(TransactionType.INCOME, 3, LocalTime.of(9, 0), bank, salary, 3_200_000, null, "회사", null);
        transactionService.create(owner.getId(), ledgerId, new Transfer(UUID.randomUUID(), OCT_1.withDayOfMonth(4),
                LocalTime.of(8, 0), bank, cash, 50_000, "용돈"), "test-device");
        fixtures.cancel(owner, fixtures.expense(owner, ledgerId, cash, null, OCT_1.withDayOfMonth(5), 7_000));
        fixtures.delete(owner, fixtures.expense(owner, ledgerId, cash, food, OCT_1.withDayOfMonth(6), 8_000));
        entry(TransactionType.EXPENSE, 7, null, cash, food, 2_000, RefundKind.REIMBURSEMENT, null, null);
        entry(TransactionType.EXPENSE, 31, LocalTime.of(23, 59), spare, food, 1_000, null, "=HYPERLINK(\"x\")",
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
                + "2026-10-07,,지출,2000,돌려받음,현금,,식비,,,,,완료,,," + me + ",6\r\n"
                + "2026-10-31,23:59,지출,1000,,'-비상금,,식비,,\"'=HYPERLINK(\"\"x\"\")\",'@SUM(A1),,완료,,," + me
                + ",7\r\n");
    }

    /** 열과 행은 CSV와 같다. 가맹점·메모는 수식으로 시작해도 원래 글자의 글자 칸이다(칸 종류는 XlsxExportTest가 본다). */
    @Test
    void 엑셀은_xlsx_파일이고_CSV와_같은_행을_쓴다() throws Exception {
        entry(TransactionType.EXPENSE, 1, null, cash, null, 16_500, null, "=1+1", "@SUM(A1)");
        fixtures.expense(owner, ledgerId, cash, null, OCT_1.withDayOfMonth(31), 1_000);

        HttpResponse<byte[]> response = HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create(
                        "http://localhost:" + port + path() + "?format=xlsx&from=2026-10-01&to=2026-10-31"))
                .header("Authorization", "Bearer " + TestAccessTokens.valid(owner.getId(), NOW)).build(),
                HttpResponse.BodyHandlers.ofByteArray());

        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.headers().firstValue("Content-Type"))
                .contains("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        assertThat(response.headers().firstValue("Cache-Control")).contains("no-store");
        assertThat(response.headers().firstValue("Content-Disposition")).hasValueSatisfying(value -> assertThat(value)
                .startsWith("attachment; filename=\"_ ____20261001_20261031.xlsx\"; filename*=UTF-8''"));
        Map<String, XlsxExportTest.Cell> cells = XlsxExportTest.cells(response.body());
        assertThat(cells.get("J2").text()).isEqualTo("=1+1");
        assertThat(cells.get("K2").text()).isEqualTo("@SUM(A1)");
        assertThat(cells.get("D3").text()).isEqualTo("1000");
        assertThat(cells.get("Q3").text()).isEqualTo("2");
        assertThat(cells).doesNotContainKey("A4");
    }

    /**
     * from과 to를 둘 다 비우면(빠지거나 빈 값) 장부 전체이고, 파일 이름의 기간은 내보낸 첫 거래와 마지막 거래의 날짜다(#379,
     * K-01 (5)). 취소한 거래는 들고 휴지통 거래는 그보다 이르거나 늦어도 이름에 들지 않는다.
     */
    @Test
    void 기간을_비우면_장부_전체이고_파일_이름은_첫_거래와_마지막_거래의_날짜다() throws Exception {
        fixtures.delete(owner, fixtures.expense(owner, ledgerId, cash, null, LocalDate.of(2026, 9, 30), 1_000));
        fixtures.expense(owner, ledgerId, cash, null, OCT_1.withDayOfMonth(3), 2_000);
        fixtures.expense(owner, ledgerId, cash, null, LocalDate.of(2026, 11, 20), 3_000);
        fixtures.cancel(owner, fixtures.expense(owner, ledgerId, cash, null, LocalDate.of(2027, 1, 15), 4_000));
        fixtures.delete(owner, fixtures.expense(owner, ledgerId, cash, null, LocalDate.of(2027, 2, 1), 5_000));

        Reply csv = client.get(path() + "?format=csv");
        Reply xlsx = client.get(path() + "?format=xlsx&from=&to=");

        assertThat(csv.status()).as(csv.body()).isEqualTo(200);
        assertThat(csv.header("Content-Disposition"))
                .startsWith("attachment; filename=\"_ ____20261003_20270115.csv\"; filename*=UTF-8''");
        assertThat(csv.body().lines().skip(1).map(line -> line.substring(0, line.indexOf(','))))
                .containsExactly("2026-10-03", "2026-11-20", "2027-01-15");
        assertThat(xlsx.status()).isEqualTo(200);
        assertThat(xlsx.header("Content-Disposition"))
                .startsWith("attachment; filename=\"_ ____20261003_20270115.xlsx\"; filename*=UTF-8''");
    }

    @Test
    void 거래가_하루뿐인_장부_전체는_시작일과_종료일이_같다() throws Exception {
        fixtures.expense(owner, ledgerId, cash, null, OCT_1.withDayOfMonth(15), 1_000);
        fixtures.expense(owner, ledgerId, cash, null, OCT_1.withDayOfMonth(15), 2_000);

        Reply reply = client.get(path() + "?format=csv");

        assertThat(reply.status()).as(reply.body()).isEqualTo(200);
        assertThat(reply.header("Content-Disposition"))
                .startsWith("attachment; filename=\"_ ____20261015_20261015.csv\"; filename*=UTF-8''");
    }

    @Test
    void 내보낼_거래가_없거나_휴지통_거래뿐이면_장부_전체도_본문_없는_204다() throws Exception {
        assertNoContent(client.get(path() + OCTOBER));
        assertNoContent(client.get(path() + "?format=csv"));

        fixtures.delete(owner, fixtures.expense(owner, ledgerId, cash, null, OCT_1.withDayOfMonth(15), 1_000));
        assertNoContent(client.get(path() + "?format=xlsx&from=&to="));
        fixtures.expense(owner, ledgerId, cash, null, LocalDate.of(2026, 11, 1), 1_000);
        assertNoContent(client.get(path() + OCTOBER));
    }

    /**
     * 오류는 Accept와 무관하게 problem+json이다. from과 to는 둘 다 비우면 장부 전체라 하나만 비웠을 때 그쪽이 REQUIRED다(#379).
     * 같은 이름을 두 번 보낸 빈 값은 비운 것이 아니라 형식 오류다.
     */
    @Test
    void format_from_to가_없거나_형식이_틀리거나_종료일이_앞서면_그_입력란의_400이다() throws Exception {
        Map<String, String[]> rejected = Map.ofEntries(
                Map.entry("", new String[] {"format:REQUIRED"}),
                Map.entry("from=&to=", new String[] {"format:REQUIRED"}),
                Map.entry("format=&from=&to=", new String[] {"format:INVALID_FORMAT"}),
                Map.entry("from=2026-10-01&to=2026-10-31", new String[] {"format:REQUIRED"}),
                Map.entry("format=pdf&from=2026-10-01&to=2026-10-31", new String[] {"format:INVALID_FORMAT"}),
                Map.entry("format=XLSX&from=2026-10-01&to=2026-10-31", new String[] {"format:INVALID_FORMAT"}),
                Map.entry("format=CSV&from=2026-10-01&to=2026-10-31", new String[] {"format:INVALID_FORMAT"}),
                Map.entry("format=csv&to=2026-10-31", new String[] {"from:REQUIRED"}),
                Map.entry("format=csv&from=2026-10-01", new String[] {"to:REQUIRED"}),
                Map.entry("format=csv&from=2026-02-29&to=2026-10-31", new String[] {"from:INVALID_FORMAT"}),
                Map.entry("format=csv&from=&to=2026-10-31", new String[] {"from:REQUIRED"}),
                Map.entry("format=csv&from=2026-10-01&to=", new String[] {"to:REQUIRED"}),
                Map.entry("format=csv&from=bad", new String[] {"from:INVALID_FORMAT", "to:REQUIRED"}),
                Map.entry("format=csv&from=&from=", new String[] {"from:INVALID_FORMAT", "to:REQUIRED"}),
                Map.entry("format=csv&from=%20&to=%20", new String[] {"from:INVALID_FORMAT", "to:INVALID_FORMAT"}),
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
        client.get(stranger + "?format=pdf&from=bad").assertProblem(404, "Not Found", "NOT_FOUND");
        client.get(stranger + "?format=csv").assertProblem(404, "Not Found", "NOT_FOUND");
        ServerClient.anonymous(port).get(path() + OCTOBER).assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
        ServerClient.anonymous(port).get(path() + "?format=csv").assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
    }

    private void entry(TransactionType type, int october, LocalTime at, UUID account, UUID category, long amount,
                       RefundKind refund, String payee, String memo) {
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
