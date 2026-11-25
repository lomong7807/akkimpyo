package app.accountbook.transaction;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.account.AccountType;
import app.accountbook.category.CategoryCommand;
import app.accountbook.category.CategoryKind;
import app.accountbook.category.CategoryService;
import app.accountbook.ledger.LedgerRole;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.transaction.TransactionCommand.Entry;
import app.accountbook.transaction.TransactionCommand.Transfer;
import app.accountbook.user.User;
import jakarta.persistence.EntityManager;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * 거래를 바꾸는 동작이 DB에 저장한 전후 값(ADR 007 결정 3, 4의 버전 1, 이슈 #108).
 * 저장된 글자를 다시 읽어 비교한다. JSONB라 키 순서는 남지 않으므로 순서는 보지 않는다.
 * 시각의 글자와 필드 목록은 {@link ChangeLogValueTest}가 본다.
 */
@IntegrationTest
class ChangeLogStoredValueTest {

    static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    static final String DEVICE = "iphone.safari";
    static final JsonMapper JSON = JsonMapper.builder().build();

    @Autowired TransactionService transactionService;
    @Autowired CategoryService categoryService;
    @Autowired Fixtures fixtures;
    @Autowired EntityManager entityManager;
    @Autowired JdbcTemplate jdbc;

    final UUID id = UUID.randomUUID();
    User owner;
    User member;
    UUID ledgerId;
    UUID cash;
    UUID bank;
    UUID food;

    @BeforeEach
    void setUp() {
        owner = fixtures.user("hong.gildong@example.com");
        member = fixtures.user("kim.cheolsu@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
        fixtures.addMember(ledgerId, member, LedgerRole.MEMBER);
        cash = fixtures.account(owner, ledgerId, "현금", AccountType.CASH, 0, LocalDate.of(2026, 11, 1)).getId();
        bank = fixtures.account(owner, ledgerId, "국민은행", AccountType.BANK, 0, LocalDate.of(2026, 11, 1)).getId();
        food = categoryService.create(owner.getId(), ledgerId, new CategoryCommand("식비", CategoryKind.EXPENSE, null))
                .getId();
    }

    @Test
    void 지출의_다섯_동작이_저장한_전후_값() {
        TransactionView created = transactionService.create(owner.getId(), ledgerId, expense(12_000), DEVICE);
        flushAndClear();
        TransactionView updated = transactionService.update(member.getId(), id, 1,
                new Entry(id, TransactionType.EXPENSE, DAY, null, bank, null, 15_000, true, null, null,
                        member.getId()), DEVICE);
        flushAndClear();
        TransactionView canceled = transactionService.cancel(owner.getId(), id, 2, DEVICE);
        flushAndClear();
        TransactionView deleted = transactionService.delete(member.getId(), id, 3, DEVICE);
        flushAndClear();
        TransactionView restored = transactionService.restore(owner.getId(), id, 4, DEVICE);

        String afterCreate = """
                {"id": "%s", "ledgerId": "%s", "type": "EXPENSE", "occurredOn": "2026-11-18",
                 "occurredTime": "07:05:09.12", "payee": "김밥천국", "memo": "점심", "status": "POSTED",
                 "createdBy": "%s", "paidBy": "%s", "version": 1, "deleted": false,
                 "createdAt": "%s", "updatedAt": "%s",
                 "lines": [{"accountId": "%s", "categoryId": "%s", "amount": -12000}]}
                """.formatted(id, ledgerId, owner.getId(), owner.getId(), created.createdAt(), created.createdAt(),
                cash, food);
        // 고친 뒤로는 시각, 가맹점, 메모가 없고 결제한 사람이 바뀌었다. 환불이라 금액이 양수다.
        String afterUpdate = changed("POSTED", 2, false, updated);
        String afterCancel = changed("CANCELED", 3, false, canceled);
        String afterDelete = changed("CANCELED", 4, true, deleted);
        String afterRestore = changed("CANCELED", 5, false, restored);
        assertStored(new Log("CREATE", null, afterCreate),
                new Log("UPDATE", afterCreate, afterUpdate),
                new Log("CANCEL", afterUpdate, afterCancel),
                new Log("DELETE", afterCancel, afterDelete),
                new Log("RESTORE", afterDelete, afterRestore));
    }

    @Test
    void 없는_값이_가장_많은_수입이_저장한_전후_값() {
        UUID uncategorized = categoryService.uncategorized(ledgerId, CategoryKind.INCOME).getId();
        TransactionView created = transactionService.create(owner.getId(), ledgerId,
                new Entry(id, TransactionType.INCOME, DAY, null, bank, null, 9_999_999_999L, false, null, null, null),
                DEVICE);
        flushAndClear();
        TransactionView canceled = transactionService.cancel(owner.getId(), id, 1, DEVICE);

        String template = """
                {"id": "%s", "ledgerId": "%s", "type": "INCOME", "occurredOn": "2026-11-18", "occurredTime": null,
                 "payee": null, "memo": null, "status": "%s", "createdBy": "%s", "paidBy": "%s",
                 "version": %d, "deleted": false, "createdAt": "%s", "updatedAt": "%s",
                 "lines": [{"accountId": "%s", "categoryId": "%s", "amount": 9999999999}]}
                """;
        String afterCreate = template.formatted(id, ledgerId, "POSTED", owner.getId(), owner.getId(), 1,
                created.createdAt(), created.createdAt(), bank, uncategorized);
        String afterCancel = template.formatted(id, ledgerId, "CANCELED", owner.getId(), owner.getId(), 2,
                created.createdAt(), canceled.updatedAt(), bank, uncategorized);
        assertStored(new Log("CREATE", null, afterCreate), new Log("CANCEL", afterCreate, afterCancel));
    }

    @Test
    void 이체가_저장한_전후_값() {
        TransactionView created = transactionService.create(owner.getId(), ledgerId,
                new Transfer(id, DAY, LocalTime.of(0, 0), bank, cash, 30_000, "인출"), DEVICE);
        flushAndClear();
        TransactionView deleted = transactionService.delete(owner.getId(), id, 1, DEVICE);

        String template = """
                {"id": "%s", "ledgerId": "%s", "type": "TRANSFER", "occurredOn": "2026-11-18",
                 "occurredTime": "00:00:00", "payee": null, "memo": "인출", "status": "POSTED",
                 "createdBy": "%s", "paidBy": null, "version": %d, "deleted": %b,
                 "createdAt": "%s", "updatedAt": "%s",
                 "lines": [{"accountId": "%s", "categoryId": null, "amount": -30000},
                           {"accountId": "%s", "categoryId": null, "amount": 30000}]}
                """;
        String afterCreate = template.formatted(id, ledgerId, owner.getId(), 1, false, created.createdAt(),
                created.createdAt(), bank, cash);
        String afterDelete = template.formatted(id, ledgerId, owner.getId(), 2, true, created.createdAt(),
                deleted.updatedAt(), bank, cash);
        assertStored(new Log("CREATE", null, afterCreate), new Log("DELETE", afterCreate, afterDelete));
    }

    /** 사람, 계좌, 카테고리는 id로만 적는다. 기기 값은 이력 행의 열에만 있다. */
    @Test
    void 이름과_이메일과_기기_값은_전후_값에_없다() {
        String notListed = "my-device-0001";
        transactionService.create(owner.getId(), ledgerId, expense(12_000), DEVICE);
        transactionService.update(member.getId(), id, 1,
                new Entry(id, TransactionType.EXPENSE, DAY, null, cash, food, 15_000, false, null, null,
                        member.getId()), notListed);
        transactionService.cancel(member.getId(), id, 2, DEVICE);
        transactionService.delete(member.getId(), id, 3, notListed);
        transactionService.restore(owner.getId(), id, 4, DEVICE);

        assertThat(stored()).hasSize(5).allSatisfy(log -> assertThat(log.before() + log.after())
                .contains(owner.getId().toString(), cash.toString(), food.toString())
                .doesNotContain(owner.getEmail(), owner.getDisplayName(), member.getEmail(), member.getDisplayName())
                .doesNotContain("현금", "국민은행", "식비")
                .doesNotContain(DEVICE, notListed, DeviceIds.UNKNOWN));
    }

    /** 앱의 매핑과 컬럼 기본값을 거치지 않고, main이 저장했던 글자 그대로의 행을 넣는다. 형식 버전은 없던 때라 비운다. */
    @Test
    void 전용_타입_이전에_저장된_전후_값도_저장된_그대로_읽힌다() {
        transactionService.create(owner.getId(), ledgerId, expense(12_000), DEVICE);
        flushAndClear();
        String before = """
                {"id": "00000000-0000-4000-8000-00000000100a", "memo": "나", "type": "EXPENSE", "lines": [{"amount": -12000, "accountId": "00000000-0000-4000-8000-0000000000c1", "categoryId": "00000000-0000-4000-8000-0000000000d3"}], "payee": "가", "paidBy": "00000000-0000-4000-8000-0000000000a1", "status": "POSTED", "deleted": false, "version": 1, "ledgerId": "00000000-0000-4000-8000-0000000000b1", "createdAt": "2026-11-24T08:30:43.292600Z", "createdBy": "00000000-0000-4000-8000-0000000000a1", "updatedAt": "2026-11-24T08:30:43.292600Z", "occurredOn": "2026-11-18", "occurredTime": "07:05:09.12"}
                """;
        String after = """
                {"id": "00000000-0000-4000-8000-00000000100a", "memo": null, "type": "EXPENSE", "lines": [{"amount": -1, "accountId": "00000000-0000-4000-8000-0000000000c1", "categoryId": null}], "payee": "가", "paidBy": null, "status": "POSTED", "deleted": true, "version": 2, "ledgerId": "00000000-0000-4000-8000-0000000000b1", "createdAt": "2026-11-24T08:30:43.292600Z", "createdBy": "00000000-0000-4000-8000-0000000000a1", "updatedAt": "2026-11-30T15:00:00Z", "occurredOn": "2026-11-18", "occurredTime": null}
                """;
        jdbc.update("""
                insert into change_log (id, transaction_id, ledger_id, version, action, actor_id, before_value,
                                        after_value, created_at)
                values (?, ?, ?, 2, 'UPDATE', ?, cast(? as jsonb), cast(? as jsonb), now())
                """, UUID.randomUUID(), id, ledgerId, owner.getId(), before, after);

        ChangeLogView read = transactionService.history(owner.getId(), id).getLast();

        assertThat(read.before()).isEqualTo(json(before));
        assertThat(read.after()).isEqualTo(json(after));
        assertThat(formatVersions()).containsExactly(ChangeLogValue.FORMAT_VERSION, (short) 1);
    }

    @Test
    void 새_이력의_형식_버전은_전용_타입의_값이다() {
        transactionService.create(owner.getId(), ledgerId, expense(12_000), DEVICE);
        transactionService.update(owner.getId(), id, 1, expense(15_000), DEVICE);
        transactionService.cancel(owner.getId(), id, 2, DEVICE);
        transactionService.delete(owner.getId(), id, 3, DEVICE);
        transactionService.restore(owner.getId(), id, 4, DEVICE);

        assertThat(formatVersions()).hasSize(5).containsOnly(ChangeLogValue.FORMAT_VERSION);
        assertThat(jdbc.queryForList("select format_version from change_log where transaction_id = ?", Short.class, id))
                .hasSize(5).containsOnly(ChangeLogValue.FORMAT_VERSION);
    }

    private void assertStored(Log... expected) {
        List<Log> stored = stored();
        assertThat(stored).extracting(Log::action).containsExactly(Stream.of(expected).map(Log::action)
                .toArray(String[]::new));
        for (int i = 0; i < expected.length; i++) {
            assertThat(json(stored.get(i).before())).as("%d번째 전 값", i + 1).isEqualTo(json(expected[i].before()));
            assertThat(json(stored.get(i).after())).as("%d번째 후 값", i + 1).isEqualTo(json(expected[i].after()));
        }
    }

    /** 값이 없는 열은 null이다. JSON의 null이 저장돼 있으면 글자 "null"이라 구분된다. */
    private List<Log> stored() {
        entityManager.flush();
        return jdbc.query("""
                select action, cast(before_value as text), cast(after_value as text) from change_log
                 where transaction_id = ? order by version
                """, (row, number) -> new Log(row.getString(1), row.getString(2), row.getString(3)), id);
    }

    /** 앱이 DB에서 읽은 형식 버전. */
    private List<Short> formatVersions() {
        return entityManager.createQuery("select c.formatVersion from ChangeLog c where c.transactionId = :id "
                + "order by c.version", Short.class).setParameter("id", id).getResultList();
    }

    private static JsonNode json(String text) {
        return text == null ? null : JSON.readTree(text);
    }

    private Entry expense(long amount) {
        return new Entry(id, TransactionType.EXPENSE, DAY, LocalTime.parse("07:05:09.120"), cash, food, amount, false,
                "김밥천국", "점심", null);
    }

    private String changed(String status, long version, boolean deleted, TransactionView view) {
        return """
                {"id": "%s", "ledgerId": "%s", "type": "EXPENSE", "occurredOn": "2026-11-18", "occurredTime": null,
                 "payee": null, "memo": null, "status": "%s", "createdBy": "%s", "paidBy": "%s",
                 "version": %d, "deleted": %b, "createdAt": "%s", "updatedAt": "%s",
                 "lines": [{"accountId": "%s", "categoryId": "%s", "amount": 15000}]}
                """.formatted(id, ledgerId, status, owner.getId(), member.getId(), version, deleted,
                view.createdAt(), view.updatedAt(), bank,
                categoryService.uncategorized(ledgerId, CategoryKind.EXPENSE).getId());
    }

    private void flushAndClear() {
        entityManager.flush();
        entityManager.clear();
    }

    private record Log(String action, String before, String after) {
    }
}
