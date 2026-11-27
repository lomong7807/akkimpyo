package app.accountbook.transaction;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * 변경 이력의 전후 값. 이 레코드의 JSON이 그대로 저장되고 저장된 이력은 고치지 않는다(ADR 007 결정 3, 4).
 * 읽기 모델이나 API 응답의 모양이 바뀌어도 따라 바꾸지 않는다. 필드를 바꾸면 {@link #FORMAT_VERSION}을 올리고
 * 읽는 쪽이 버전별로 해석한다.
 *
 * <p>사람, 계좌, 카테고리는 id로만 적는다. 이름, 이메일, 토큰, 요청 정보, 기기 값은 넣지 않는다.
 */
record ChangeLogValue(
        UUID id,
        UUID ledgerId,
        TransactionType type,
        LocalDate occurredOn,
        LocalTime occurredTime,
        String payee,
        String memo,
        TransactionStatus status,
        UUID createdBy,
        UUID paidBy,
        long version,
        boolean deleted,
        Instant createdAt,
        Instant updatedAt,
        List<Line> lines) {

    /** 전후 값의 형식 버전. 이력 행마다 같이 저장한다. */
    static final short FORMAT_VERSION = 1;

    /** 이력 전용이다. 스프링의 매퍼는 API 형식(ADR 002)에 맞춰 설정이 바뀔 수 있어 쓰지 않는다. */
    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    static ChangeLogValue of(Transaction tx) {
        return new ChangeLogValue(
                tx.getId(),
                tx.getLedgerId(),
                tx.getType(),
                tx.getOccurredOn(),
                tx.getOccurredTime(),
                tx.getPayee(),
                tx.getMemo(),
                tx.getStatus(),
                tx.getCreatedBy(),
                tx.getPaidBy(),
                tx.getVersion(),
                tx.isDeleted(),
                tx.getCreatedAt(),
                tx.getUpdatedAt(),
                tx.getLines().stream().map(Line::of).toList());
    }

    JsonNode toJson() {
        return MAPPER.valueToTree(this);
    }

    /**
     * 저장된 전후 값을 그 행의 형식 버전으로 읽는다(ADR 007 결정 4). 지금은 버전 1뿐이고 그 모양이 이 레코드다. 값이 없으면
     * ({@code CREATE}의 전 값, 완전 삭제 기록) null이다.
     */
    static ChangeLogValue read(short formatVersion, JsonNode json) {
        if (formatVersion != FORMAT_VERSION) {
            throw new IllegalStateException("모르는 이력 형식 버전: " + formatVersion);
        }
        return json == null || json.isNull() ? null : MAPPER.treeToValue(json, ChangeLogValue.class);
    }

    /** 분개 라인. amount는 부호가 있는 정수 원이다. */
    record Line(UUID accountId, UUID categoryId, long amount) {

        static Line of(TransactionLine line) {
            return new Line(line.getAccountId(), line.getCategoryId(), line.getAmount());
        }
    }
}
