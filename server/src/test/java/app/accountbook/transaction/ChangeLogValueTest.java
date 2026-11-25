package app.accountbook.transaction;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static org.assertj.core.api.Assertions.assertThat;

import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.util.ReflectionTestUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * 변경 이력 전후 값의 모양을 고정한다(ADR 007 결정 3, 4의 버전 1, 이슈 #108).
 * 실패하면 저장 형식이 바뀐 것이다. 이미 쌓인 이력은 고칠 수 없으므로, 바꾸려던 것이라면 기대를 맞추기 전에
 * 형식 버전을 올리고 읽는 쪽이 지난 버전을 해석하게 한다.
 */
class ChangeLogValueTest {

    static final JsonMapper JSON = JsonMapper.builder().build();

    static final UUID ID = UUID.fromString("0a000000-0000-4000-8000-000000000001");
    static final UUID LEDGER = UUID.fromString("0a000000-0000-4000-8000-000000000002");
    static final UUID AUTHOR = UUID.fromString("0a000000-0000-4000-8000-000000000003");
    static final UUID PAYER = UUID.fromString("0a000000-0000-4000-8000-000000000004");
    static final UUID ACCOUNT = UUID.fromString("0a000000-0000-4000-8000-000000000005");
    static final UUID OTHER_ACCOUNT = UUID.fromString("0a000000-0000-4000-8000-000000000006");
    static final UUID CATEGORY = UUID.fromString("0a000000-0000-4000-8000-000000000007");
    /** 한국 시각으로는 2027-01-01 00:00이다. 기록 시각은 UTC로 적고 날짜는 입력한 그대로다. */
    static final Instant CREATED = Instant.parse("2026-12-31T15:00:00Z");
    static final Instant UPDATED = Instant.parse("2027-01-02T08:30:43.292603Z");

    @Test
    void 형식_버전은_1이다() {
        assertThat(ChangeLogValue.FORMAT_VERSION).isEqualTo((short) 1);
    }

    /** 금액과 version은 32비트를 넘는 값이다. 전체 복원이 version을 크게 올린다(ADR 008 결정 10). */
    @Test
    void 모든_값이_있는_거래의_JSON() {
        Transaction tx = transaction(TransactionType.EXPENSE, LocalTime.of(23, 59, 59, 999_000_000), "김밥천국", "점심",
                PAYER);
        tx.addLine(ACCOUNT, CATEGORY, -9_999_999_999L);
        tx.cancel();
        tx.markDeleted(UPDATED);
        tx.applyVersion(3_590_000_000L, UPDATED);

        assertThat(storedJson(tx)).isEqualTo(JSON.readTree("""
                {
                  "id": "0a000000-0000-4000-8000-000000000001",
                  "ledgerId": "0a000000-0000-4000-8000-000000000002",
                  "type": "EXPENSE",
                  "occurredOn": "2026-12-31",
                  "occurredTime": "23:59:59.999",
                  "payee": "김밥천국",
                  "memo": "점심",
                  "status": "CANCELED",
                  "createdBy": "0a000000-0000-4000-8000-000000000003",
                  "paidBy": "0a000000-0000-4000-8000-000000000004",
                  "version": 3590000000,
                  "deleted": true,
                  "createdAt": "2026-12-31T15:00:00Z",
                  "updatedAt": "2027-01-02T08:30:43.292603Z",
                  "lines": [
                    {
                      "accountId": "0a000000-0000-4000-8000-000000000005",
                      "categoryId": "0a000000-0000-4000-8000-000000000007",
                      "amount": -9999999999
                    }
                  ]
                }
                """));
    }

    @Test
    void 값이_없는_필드는_빼지_않고_null로_넣는다() {
        Transaction tx = transaction(TransactionType.TRANSFER, null, null, null, null);
        tx.addLine(ACCOUNT, null, -30_000);
        tx.addLine(OTHER_ACCOUNT, null, 30_000);

        assertThat(storedJson(tx)).isEqualTo(JSON.readTree("""
                {
                  "id": "0a000000-0000-4000-8000-000000000001",
                  "ledgerId": "0a000000-0000-4000-8000-000000000002",
                  "type": "TRANSFER",
                  "occurredOn": "2026-12-31",
                  "occurredTime": null,
                  "payee": null,
                  "memo": null,
                  "status": "POSTED",
                  "createdBy": "0a000000-0000-4000-8000-000000000003",
                  "paidBy": null,
                  "version": 1,
                  "deleted": false,
                  "createdAt": "2026-12-31T15:00:00Z",
                  "updatedAt": "2026-12-31T15:00:00Z",
                  "lines": [
                    {
                      "accountId": "0a000000-0000-4000-8000-000000000005",
                      "categoryId": null,
                      "amount": -30000
                    },
                    {
                      "accountId": "0a000000-0000-4000-8000-000000000006",
                      "categoryId": null,
                      "amount": 30000
                    }
                  ]
                }
                """));
    }

    /** 위의 JSON에 드러나지 않는 변경(값이 없으면 빠지는 새 필드, JSON은 같고 형만 다른 필드)도 잡는다. */
    @Test
    void 필드의_이름과_형은_정해진_것뿐이다() {
        assertThat(fields(ChangeLogValue.class)).containsExactlyInAnyOrder("UUID id", "UUID ledgerId",
                "TransactionType type", "LocalDate occurredOn", "LocalTime occurredTime", "String payee",
                "String memo", "TransactionStatus status", "UUID createdBy", "UUID paidBy", "long version",
                "boolean deleted", "Instant createdAt", "Instant updatedAt", "List lines");
        assertThat(fields(ChangeLogValue.Line.class)).containsExactlyInAnyOrder("UUID accountId", "UUID categoryId",
                "long amount");
    }

    /** 초까지 적고, 소수는 있을 때만 끝의 0을 빼고 적는다. 밀리초 아래는 거래가 저장하지 않는다. */
    @ParameterizedTest
    @CsvSource({
            "00:00,              00:00:00",
            "12:30,              12:30:00",
            "07:05:09,           07:05:09",
            "07:05:09.123,       07:05:09.123",
            "07:05:09.120,       07:05:09.12",
            "07:05:09.100,       07:05:09.1",
            "07:05:09.123456789, 07:05:09.123",
            "07:05:09.000999999, 07:05:09",
            "23:59:59.999,       23:59:59.999"})
    void 거래_시각의_글자(String entered, String stored) {
        Transaction tx = transaction(TransactionType.INCOME, LocalTime.parse(entered), null, null, null);

        assertThat(storedJson(tx).path("occurredTime").asString()).isEqualTo(stored);
    }

    /** UTC이고, 소수는 값에 따라 0, 3, 6자리다. 3자리 안에서는 끝의 0을 빼지 않는다. */
    @ParameterizedTest
    @ValueSource(strings = {
            "2026-11-24T08:30:00Z",
            "2026-11-24T08:30:43Z",
            "2026-11-24T08:30:43.100Z",
            "2026-11-24T08:30:43.120Z",
            "2026-11-24T08:30:43.292603Z",
            "2026-11-24T08:30:43.292600Z",
            "2026-11-24T08:30:43.000001Z",
            "2026-11-30T14:59:59.999999Z",
            "2026-11-30T15:00:00Z"})
    void 기록_시각의_글자(String instant) {
        Transaction tx = transaction(TransactionType.INCOME, null, null, null, null);
        ReflectionTestUtils.setField(tx, "createdAt", Instant.parse(instant));
        assertThat(storedJson(tx).path("createdAt").asString()).isEqualTo(instant);

        tx.applyVersion(2, Instant.parse(instant));
        assertThat(storedJson(tx).path("updatedAt").asString()).isEqualTo(instant);
    }

    @ParameterizedTest
    @ValueSource(strings = {"EXPENSE", "INCOME", "TRANSFER"})
    void 거래_종류의_글자(String type) {
        Transaction tx = transaction(TransactionType.valueOf(type), null, null, null, null);

        assertThat(storedJson(tx).path("type").asString()).isEqualTo(type);
    }

    @ParameterizedTest
    @ValueSource(strings = {"PENDING", "POSTED", "CANCELED"})
    void 거래_상태의_글자(String status) {
        Transaction tx = transaction(TransactionType.EXPENSE, null, null, null, null);
        ReflectionTestUtils.setField(tx, "status", TransactionStatus.valueOf(status));

        assertThat(storedJson(tx).path("status").asString()).isEqualTo(status);
    }

    /** 읽기 모델에 필드를 더하거나 이름을 바꿔도 저장 형식이 따라 바뀌지 않는다(ADR 007 결정 4). */
    @Test
    void 이력은_읽기_모델을_참조하지_않는다() {
        noClasses().that().belongToAnyOf(ChangeLogValue.class, ChangeLog.class)
                .should().dependOnClassesThat().belongToAnyOf(TransactionView.class)
                .check(new ClassFileImporter().withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
                        .importPackagesOf(ChangeLogValue.class));
    }

    private static Transaction transaction(TransactionType type, LocalTime time, String payee, String memo,
                                           UUID paidBy) {
        Transaction tx = Transaction.of(ID, LEDGER, type, LocalDate.of(2026, 12, 31), time, payee, memo, AUTHOR,
                paidBy);
        ReflectionTestUtils.setField(tx, "createdAt", CREATED);
        tx.applyVersion(Transaction.INITIAL_VERSION, CREATED);
        return tx;
    }

    /** 저장되는 글자로 바꿨다가 다시 읽은 것이라 정수와 소수, 숫자와 글자, 없는 필드와 null이 구분된다. */
    private static JsonNode storedJson(Transaction tx) {
        return JSON.readTree(ChangeLogValue.of(tx).toJson().toString());
    }

    private static List<String> fields(Class<? extends Record> type) {
        return Arrays.stream(type.getRecordComponents())
                .map(field -> field.getType().getSimpleName() + " " + field.getName())
                .toList();
    }
}
