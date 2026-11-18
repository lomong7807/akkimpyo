package app.accountbook.transaction;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.UUID;

/**
 * 변경 이력 1행. before·after는 그 시점 {@link TransactionView}의 JSON을 그대로 돌려준다.
 * 이력은 고치지 않으므로, 나중에 TransactionView의 모양이 바뀌어도 기록된 값을 원래대로 보여준다.
 */
public record ChangeLogView(
        UUID id,
        UUID transactionId,
        ChangeAction action,
        UUID actorId,
        String deviceId,
        JsonNode before,
        JsonNode after,
        Instant createdAt) {

    public static ChangeLogView of(ChangeLog log) {
        return new ChangeLogView(
                log.getId(),
                log.getTransactionId(),
                log.getAction(),
                log.getActorId(),
                log.getDeviceId(),
                log.getBeforeValue(),
                log.getAfterValue(),
                log.getCreatedAt());
    }
}
