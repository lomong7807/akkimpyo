package app.accountbook.api;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.transaction.RefundKind;
import app.accountbook.transaction.TransactionCommand;
import app.accountbook.transaction.TransactionType;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jspecify.annotations.Nullable;
import tools.jackson.databind.JsonNode;

/**
 * 거래 고치기 요청의 본문(#36 요청 계약). 만들기({@link TransactionRequest})와 같은 단식 모양에서 {@code id}를 빼고
 * {@code version}을 더한다. 거래 id는 경로의 것이고 본문에 {@code id}가 있어도 읽지 않는다. 칸마다의 규칙과
 * {@code fieldErrors}는 만들기와 같다. 단 {@code refundKind}가 빠지면 저장된 값을 유지하고, {@code null}이면 일반 지출이다
 * (#102 계약. paidBy와 같은 규칙).
 *
 * @param version 고치기 전에 본 version
 */
record TransactionUpdateRequest(@Schema(requiredMode = REQUIRED, implementation = TransactionType.class) JsonNode type,
                                @Schema(requiredMode = REQUIRED, implementation = LocalDate.class) JsonNode occurredOn,
                                @Schema(implementation = String.class, pattern = TransactionRequest.TIME_PATTERN,
                                        description = "없거나 null이면 시각 없음") JsonNode occurredTime,
                                @Schema(implementation = UUID.class, description = TransactionRequest.ENTRY_ONLY + " 필수")
                                JsonNode accountId,
                                @Schema(implementation = UUID.class,
                                        description = TransactionRequest.ENTRY_ONLY + " 없거나 null이면 미분류")
                                JsonNode categoryId,
                                @Schema(requiredMode = REQUIRED, implementation = Long.class, minimum = "1",
                                        maximum = "9999999999", description = "원 단위 양수") JsonNode amount,
                                @Schema(implementation = String.class, description = TransactionRequest.ENTRY_ONLY)
                                JsonNode payee,
                                @Schema(implementation = String.class) JsonNode memo,
                                @Schema(implementation = RefundKind.class,
                                        description = "지출에만. 없으면 저장된 값을 두고, null이면 일반 지출")
                                @Nullable JsonNode refundKind,
                                @Schema(implementation = UUID.class, description = TransactionRequest.TRANSFER_ONLY)
                                JsonNode fromAccountId,
                                @Schema(implementation = UUID.class, description = TransactionRequest.TRANSFER_ONLY)
                                JsonNode toAccountId,
                                @Schema(requiredMode = REQUIRED, implementation = Long.class,
                                        description = "고치기 전에 본 version") JsonNode version) {

    /** 빠지거나 읽을 수 없는 칸이 하나라도 있으면 version까지 모두 담아 거부한다. */
    Change change(UUID transactionId) {
        List<InvalidRequestException> errors = new ArrayList<>();
        TransactionCommand command = new TransactionRequest(null, type, occurredOn, occurredTime, accountId,
                categoryId, amount, payee, memo, refundKind, fromAccountId, toAccountId).command(transactionId, errors);
        long expectedVersion = readVersion(version, errors);
        if (!errors.isEmpty()) {
            throw InvalidRequestException.ofAll(errors);
        }
        // 빠진 칸은 null로, JSON null은 NullNode로 들어온다.
        boolean keepRefundKind = refundKind == null || refundKind.isMissingNode();
        return new Change(command, expectedVersion, keepRefundKind);
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

    /**
     * 오류가 없을 때만 만든다.
     *
     * @param keepRefundKind 본문에 {@code refundKind}가 없었는가. 그러면 저장된 환불 구분을 유지한다
     */
    record Change(TransactionCommand command, long version, boolean keepRefundKind) {
    }
}
