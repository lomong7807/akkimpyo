package app.accountbook.api;

import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.transaction.TransactionCommand;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

/**
 * 거래 고치기 요청의 본문(#36 요청 계약). 만들기({@link TransactionRequest})와 같은 단식 모양에서 {@code id}를 빼고
 * {@code version}을 더한다. 거래 id는 경로의 것이고 본문에 {@code id}가 있어도 읽지 않는다. 칸마다의 규칙과
 * {@code fieldErrors}는 만들기와 같다.
 *
 * @param version 고치기 전에 본 version
 */
record TransactionUpdateRequest(JsonNode type, JsonNode occurredOn, JsonNode occurredTime, JsonNode accountId,
                                JsonNode categoryId, JsonNode amount, JsonNode payee, JsonNode memo,
                                JsonNode fromAccountId, JsonNode toAccountId, JsonNode version) {

    /** 빠지거나 읽을 수 없는 칸이 하나라도 있으면 version까지 모두 담아 거부한다. */
    Change change(UUID transactionId) {
        List<InvalidRequestException> errors = new ArrayList<>();
        TransactionCommand command = new TransactionRequest(null, type, occurredOn, occurredTime, accountId,
                categoryId, amount, payee, memo, fromAccountId, toAccountId).command(transactionId, errors);
        long expectedVersion = readVersion(version, errors);
        if (!errors.isEmpty()) {
            throw InvalidRequestException.ofAll(errors);
        }
        return new Change(command, expectedVersion);
    }

    /**
     * 본문의 {@code version}. JSON 정수만 받는다({@code 1.0}, {@code "1"}은 아니다). 빠지면 {@code REQUIRED}, 그 밖은
     * {@code INVALID_FORMAT}이다(#36, #38). 저장된 version과 다른 수는 형식 오류가 아니라 충돌(409)이다.
     */
    static long readVersion(JsonNode node, List<InvalidRequestException> errors) {
        if (node == null || node.isNull() || node.isMissingNode()) {
            errors.add(new InvalidRequestException("version", FieldErrorCode.REQUIRED, "값이 없습니다."));
        } else if (!node.isIntegralNumber() || !node.canConvertToLong()) {
            errors.add(new InvalidRequestException("version", FieldErrorCode.INVALID_FORMAT, "읽을 수 없는 값입니다."));
        } else {
            return node.longValue();
        }
        return 0;
    }

    /** 오류가 없을 때만 만든다. */
    record Change(TransactionCommand command, long version) {
    }
}
