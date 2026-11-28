package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

import app.accountbook.api.TransactionUpdateRequest.Change;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.transaction.RefundKind;
import app.accountbook.transaction.TransactionCommand;
import app.accountbook.transaction.TransactionCommand.Entry;
import app.accountbook.transaction.TransactionCommand.Transfer;
import app.accountbook.transaction.TransactionType;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import tools.jackson.databind.json.JsonMapper;

/**
 * 거래 만들기 본문을 읽는 규칙(#14 요청 계약, ADR 002 2절). 빠졌거나 읽을 수 없는 칸은 모두 알리고, 값을 다른 형으로 바꿔
 * 받지 않는다. 범위와 참조는 서비스가 본다. 스프링과 DB 없이 돈다.
 */
class TransactionRequestTest {

    private static final JsonMapper JSON = new JsonMapper();
    private static final UUID ID = UUID.fromString("0b9f6c1e-3d52-4a7e-9c11-5f2e8a7d4b60");
    private static final UUID ACCOUNT = UUID.fromString("7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f");
    private static final UUID OTHER_ACCOUNT = UUID.fromString("1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d");
    /** 이 값을 넣으면 그 칸을 본문에서 뺀다. */
    private static final String OMIT = "(빠짐)";

    @Test
    void 지출은_Entry가_되고_환불이_아니며_결제한_사람을_비워_둔다() {
        Map<String, String> fields = expense();
        fields.put("id", quoted(ID.toString().toUpperCase()));
        fields.put("refund", "true");
        fields.put("paidBy", quoted(OTHER_ACCOUNT));
        fields.put("fromAccountId", "1");

        TransactionCommand command = read(fields).command();

        assertThat(command).isEqualTo(new Entry(ID, TransactionType.EXPENSE, LocalDate.of(2026, 11, 18),
                LocalTime.of(8, 5), ACCOUNT, OTHER_ACCOUNT, 12_000, null, "김밥천국", "점심", null));
    }

    @Test
    void 이체는_Transfer가_되고_지출의_칸은_읽지_않는다() {
        Map<String, String> fields = transfer();
        fields.put("payee", "1");
        fields.put("categoryId", "\"x\"");

        assertThat(read(fields).command()).isEqualTo(new Transfer(ID, LocalDate.of(2026, 11, 18), null, ACCOUNT,
                OTHER_ACCOUNT, 50_000, null));
    }

    @Test
    void 빠진_칸과_null은_같고_필수_칸을_모두_알린다() {
        assertRejected("{}", "id:REQUIRED", "type:REQUIRED", "occurredOn:REQUIRED", "amount:REQUIRED");
        assertRejected("{\"id\":null,\"type\":null,\"occurredOn\":null,\"amount\":null}",
                "id:REQUIRED", "type:REQUIRED", "occurredOn:REQUIRED", "amount:REQUIRED");
        assertRejected("{\"type\":\"EXPENSE\"}", "id:REQUIRED", "occurredOn:REQUIRED", "amount:REQUIRED",
                "accountId:REQUIRED");
        assertRejected("{\"type\":\"TRANSFER\"}", "id:REQUIRED", "occurredOn:REQUIRED", "amount:REQUIRED",
                "fromAccountId:REQUIRED", "toAccountId:REQUIRED");
    }

    @Test
    void 선택_칸은_비워도_된다() {
        Map<String, String> fields = expense();
        fields.put("occurredTime", "null");
        fields.put("categoryId", OMIT);
        fields.put("payee", "null");
        fields.put("memo", OMIT);

        assertThat(read(fields).command()).isEqualTo(new Entry(ID, TransactionType.EXPENSE,
                LocalDate.of(2026, 11, 18), null, ACCOUNT, null, 12_000, null, null, null, null));
    }

    @ParameterizedTest(name = "{0} = {1} → {2}")
    @CsvSource(delimiterString = "|", quoteCharacter = '\'', textBlock = """
            id            | ""                               | INVALID_FORMAT
            id            | "AAECAwQFBgcICQoLDA0ODw=="       | INVALID_FORMAT
            id            | "1-1-1-1-1"                      | INVALID_FORMAT
            id            | "0b9f6c1e3d524a7e9c115f2e8a7d4b60" | INVALID_FORMAT
            id            | "{0b9f6c1e-3d52-4a7e-9c11-5f2e8a7d4b60}" | INVALID_FORMAT
            id            | 1                                | INVALID_FORMAT
            type          | "expense"                        | INVALID_FORMAT
            type          | ""                               | INVALID_FORMAT
            type          | 0                                | INVALID_FORMAT
            occurredOn    | "2026-02-30"                     | INVALID_FORMAT
            occurredOn    | "2026-11-1"                      | INVALID_FORMAT
            occurredOn    | "+2026-11-18"                    | INVALID_FORMAT
            occurredOn    | "2026-11-18T00:00:00Z"           | INVALID_FORMAT
            occurredOn    | [2026,11,18]                     | INVALID_FORMAT
            occurredTime  | "08:05:00"                       | INVALID_FORMAT
            occurredTime  | "8:05"                           | INVALID_FORMAT
            occurredTime  | "24:00"                          | INVALID_FORMAT
            occurredTime  | "08:60"                          | INVALID_FORMAT
            occurredTime  | ""                               | INVALID_FORMAT
            occurredTime  | [8,5]                            | INVALID_FORMAT
            occurredTime  | 805                              | INVALID_FORMAT
            accountId     | "x"                              | INVALID_FORMAT
            accountId     | {}                               | INVALID_FORMAT
            categoryId    | ""                               | INVALID_FORMAT
            amount        | "5"                              | INVALID_FORMAT
            amount        | 1.0                              | INVALID_FORMAT
            amount        | 1e3                              | INVALID_FORMAT
            amount        | true                             | INVALID_FORMAT
            amount        | 99999999999999999999             | OUT_OF_RANGE
            payee         | 1                                | INVALID_FORMAT
            memo          | {}                               | INVALID_FORMAT
            refundKind    | "refund"                         | INVALID_FORMAT
            refundKind    | ""                               | INVALID_FORMAT
            refundKind    | true                             | INVALID_FORMAT
            refundKind    | 1                                | INVALID_FORMAT
            """)
    void 지출의_한_칸을_읽을_수_없으면_그_칸의_이유다(String field, String value, String code) {
        Map<String, String> fields = expense();
        fields.put(field, value);

        assertRejected(json(fields), field + ":" + code);
    }

    @ParameterizedTest(name = "{0} → {1}")
    @CsvSource(delimiterString = "|", textBlock = """
            "REFUND"        | REFUND
            "REIMBURSEMENT" | REIMBURSEMENT
            null            |
            (빠짐)          |
            """)
    void 지출의_refundKind는_이름이_같은_값이고_빠지거나_null이면_일반_지출이다(String value, RefundKind expected) {
        Map<String, String> fields = expense();
        fields.put("refundKind", value);

        assertThat(((Entry) read(fields).command()).refundKind()).isEqualTo(expected);
    }

    @Test
    void 수입과_이체에_refundKind가_있으면_NOT_ALLOWED다() {
        Map<String, String> income = expense();
        income.put("type", "\"INCOME\"");
        income.put("refundKind", "\"REFUND\"");
        Map<String, String> transfer = transfer();
        transfer.put("refundKind", "\"REIMBURSEMENT\"");

        assertRejected(json(income), "refundKind:NOT_ALLOWED");
        assertRejected(json(transfer), "refundKind:NOT_ALLOWED");
        income.put("refundKind", "null");
        assertThat(((Entry) read(income).command()).refundKind()).isNull();
    }

    /** 고치기만 빠진 칸과 null이 다르다(#102 계약). */
    @Test
    void 고치기는_refundKind가_빠지면_저장된_값을_유지하고_null이나_값이면_그대로_바꾼다() {
        String body = "{\"type\":\"EXPENSE\",\"occurredOn\":\"2026-11-18\",\"accountId\":" + quoted(ACCOUNT)
                + ",\"amount\":12000,\"version\":3";

        assertThat(change(body + "}").keepRefundKind()).isTrue();
        Change cleared = change(body + ",\"refundKind\":null}");
        assertThat(cleared.keepRefundKind()).isFalse();
        assertThat(((Entry) cleared.command()).refundKind()).isNull();
        Change set = change(body + ",\"refundKind\":\"REIMBURSEMENT\"}");
        assertThat(set.keepRefundKind()).isFalse();
        assertThat(((Entry) set.command()).refundKind()).isEqualTo(RefundKind.REIMBURSEMENT);
    }

    @ParameterizedTest(name = "{0} = {1} → {2}")
    @CsvSource(delimiterString = "|", quoteCharacter = '\'', textBlock = """
            fromAccountId | (빠짐) | REQUIRED
            fromAccountId | null   | REQUIRED
            toAccountId   | "x"    | INVALID_FORMAT
            memo          | 1      | INVALID_FORMAT
            """)
    void 이체의_한_칸을_읽을_수_없으면_그_칸의_이유다(String field, String value, String code) {
        Map<String, String> fields = transfer();
        fields.put(field, value);

        assertRejected(json(fields), field + ":" + code);
    }

    @Test
    void 범위와_규칙은_서비스가_본다() {
        Map<String, String> fields = transfer();
        fields.put("amount", "-1");
        fields.put("toAccountId", quoted(ACCOUNT));
        fields.put("occurredOn", "\"1999-12-31\"");

        assertThat(read(fields).command()).isEqualTo(new Transfer(ID, LocalDate.of(1999, 12, 31), null, ACCOUNT,
                ACCOUNT, -1, null));
    }

    private static void assertRejected(String json, String... expected) {
        InvalidRequestException e = catchThrowableOfType(InvalidRequestException.class,
                () -> JSON.readValue(json, TransactionRequest.class).command());
        assertThat(e).as(json).isNotNull();
        assertThat(e.errors()).extracting(error -> error.field() + ":" + error.code())
                .containsExactlyInAnyOrder(expected);
    }

    private static Change change(String json) {
        return JSON.readValue(json, TransactionUpdateRequest.class).change(ID);
    }

    private static TransactionRequest read(Map<String, String> fields) {
        return JSON.readValue(json(fields), TransactionRequest.class);
    }

    private static Map<String, String> expense() {
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("id", quoted(ID));
        fields.put("type", "\"EXPENSE\"");
        fields.put("occurredOn", "\"2026-11-18\"");
        fields.put("occurredTime", "\"08:05\"");
        fields.put("accountId", quoted(ACCOUNT));
        fields.put("categoryId", quoted(OTHER_ACCOUNT));
        fields.put("amount", "12000");
        fields.put("payee", "\"김밥천국\"");
        fields.put("memo", "\"점심\"");
        return fields;
    }

    private static Map<String, String> transfer() {
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("id", quoted(ID));
        fields.put("type", "\"TRANSFER\"");
        fields.put("occurredOn", "\"2026-11-18\"");
        fields.put("fromAccountId", quoted(ACCOUNT));
        fields.put("toAccountId", quoted(OTHER_ACCOUNT));
        fields.put("amount", "50000");
        return fields;
    }

    /** 값은 JSON 글자 그대로다. */
    private static String json(Map<String, String> fields) {
        return fields.entrySet().stream()
                .filter(field -> !field.getValue().equals(OMIT))
                .map(field -> "\"" + field.getKey() + "\":" + field.getValue())
                .collect(Collectors.joining(",", "{", "}"));
    }

    private static String quoted(Object value) {
        return "\"" + value + "\"";
    }
}
