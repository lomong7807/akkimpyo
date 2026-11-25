package app.accountbook.transaction;

import java.time.Instant;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

/**
 * 변경 이력 1행. before·after는 저장된 JSON({@link ChangeLogValue})을 해석하지 않고 그대로 돌려준다.
 * 이력은 고치지 않으므로, 나중에 ChangeLogValue의 모양이 바뀌어도 기록된 값을 원래대로 보여준다.
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
