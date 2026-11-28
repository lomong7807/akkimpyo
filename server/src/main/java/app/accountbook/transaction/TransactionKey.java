package app.accountbook.transaction;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Objects;
import java.util.UUID;

/**
 * 거래 목록에서 거래 하나의 자리(정렬 키, #15). 순서는 날짜↓, 같은 날은 시각 있는 거래가 시각↓으로 먼저, 시각 없는 거래가
 * 그 아래, 그다음 id↓다. id는 DB의 uuid 순서(바이트 순서)다. 다음 쪽은 앞 쪽 마지막 거래의 키 뒤부터다.
 *
 * @param occurredTime 저장된 시각 그대로(밀리초까지). 시각 없음이면 null
 */
public record TransactionKey(LocalDate occurredOn, LocalTime occurredTime, UUID id) {

    public TransactionKey {
        Objects.requireNonNull(occurredOn, "occurredOn");
        Objects.requireNonNull(id, "id");
    }

    static TransactionKey of(TransactionView tx) {
        return new TransactionKey(tx.occurredOn(), tx.occurredTime(), tx.id());
    }
}
