package app.accountbook.transaction;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.NullNode;
import tools.jackson.databind.node.ObjectNode;

/** 저장된 전후 값을 형식 버전대로 읽는다(ADR 007 결정 4, #47, #8). 스프링과 DB 없이 돈다. */
class ChangeLogValueReadTest {

    private static final ChangeLogValue STORED = value(TransactionType.EXPENSE, RefundKind.REIMBURSEMENT,
            List.of(new ChangeLogValue.Line(UUID.randomUUID(), null, 12_000)));

    @Test
    void 버전_2는_저장한_값_그대로_읽히고_값이_없으면_null이다() {
        assertThat(ChangeLogValue.read((short) 2, STORED.toJson())).isEqualTo(STORED);
        assertThat(ChangeLogValue.read((short) 2, null)).isNull();
        assertThat(ChangeLogValue.read((short) 2, NullNode.getInstance())).isNull();
        assertThat(ChangeLogValue.read((short) 1, null)).isNull();
    }

    /** V24가 옛 행을 옮긴 규칙과 같다: 양수 지출은 REFUND, 음수 지출·수입·이체는 null. */
    @Test
    void 버전_1은_refundKind가_없고_양수_지출_라인만_환불로_읽는다() {
        UUID account = UUID.randomUUID();

        assertThat(readV1(TransactionType.EXPENSE, List.of(new ChangeLogValue.Line(account, null, 3_000))))
                .isEqualTo(RefundKind.REFUND);
        assertThat(readV1(TransactionType.EXPENSE, List.of(new ChangeLogValue.Line(account, null, -3_000))))
                .isNull();
        assertThat(readV1(TransactionType.INCOME, List.of(new ChangeLogValue.Line(account, null, 3_000)))).isNull();
        assertThat(readV1(TransactionType.TRANSFER, List.of(new ChangeLogValue.Line(account, null, -3_000),
                new ChangeLogValue.Line(UUID.randomUUID(), null, 3_000)))).isNull();
    }

    @Test
    void 모르는_형식_버전은_읽지_않는다() {
        assertThatThrownBy(() -> ChangeLogValue.read((short) 3, STORED.toJson()))
                .isInstanceOf(IllegalStateException.class);
    }

    private static RefundKind readV1(TransactionType type, List<ChangeLogValue.Line> lines) {
        JsonNode json = value(type, null, lines).toJson();
        ((ObjectNode) json).remove("refundKind");
        ChangeLogValue read = ChangeLogValue.read((short) 1, json);
        assertThat(read.lines()).isEqualTo(lines);
        return read.refundKind();
    }

    private static ChangeLogValue value(TransactionType type, RefundKind kind, List<ChangeLogValue.Line> lines) {
        return new ChangeLogValue(UUID.randomUUID(), UUID.randomUUID(), type, LocalDate.of(2026, 11, 18),
                LocalTime.of(7, 5, 9, 120_000_000), "김밥천국", null, TransactionStatus.POSTED, UUID.randomUUID(), null,
                kind, 3, true, Instant.parse("2026-11-24T08:30:43.292603Z"), Instant.parse("2026-11-24T08:30:43Z"),
                lines);
    }
}
