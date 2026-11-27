package app.accountbook.transaction;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.node.NullNode;

/** 저장된 전후 값을 형식 버전대로 읽는다(ADR 007 결정 4, #47). 스프링과 DB 없이 돈다. */
class ChangeLogValueReadTest {

    private static final ChangeLogValue STORED = new ChangeLogValue(UUID.randomUUID(), UUID.randomUUID(),
            TransactionType.EXPENSE, LocalDate.of(2026, 11, 18), LocalTime.of(7, 5, 9, 120_000_000), "김밥천국", null,
            TransactionStatus.POSTED, UUID.randomUUID(), null, 3, true, Instant.parse("2026-11-24T08:30:43.292603Z"),
            Instant.parse("2026-11-24T08:30:43Z"), List.of(new ChangeLogValue.Line(UUID.randomUUID(), null, -12_000)));

    @Test
    void 버전_1은_저장한_값_그대로_읽히고_값이_없으면_null이다() {
        assertThat(ChangeLogValue.read((short) 1, STORED.toJson())).isEqualTo(STORED);
        assertThat(ChangeLogValue.read((short) 1, null)).isNull();
        assertThat(ChangeLogValue.read((short) 1, NullNode.getInstance())).isNull();
    }

    @Test
    void 모르는_형식_버전은_읽지_않는다() {
        assertThatThrownBy(() -> ChangeLogValue.read((short) 2, STORED.toJson()))
                .isInstanceOf(IllegalStateException.class);
    }
}
