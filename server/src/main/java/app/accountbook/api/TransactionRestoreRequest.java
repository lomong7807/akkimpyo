package app.accountbook.api;

import app.accountbook.common.InvalidRequestException;
import java.util.ArrayList;
import java.util.List;
import tools.jackson.databind.JsonNode;

/**
 * 거래 되살리기 요청의 본문(#38 계약): {@code { "version": N }}. 그 밖의 칸은 읽지 않는다.
 *
 * @param version 되살리기 전에 본 version(휴지통에 넣은 뒤의 version)
 */
record TransactionRestoreRequest(JsonNode version) {

    /** 빠지면 {@code version:REQUIRED}, JSON 정수가 아니면 {@code version:INVALID_FORMAT}이다(고치기와 같다). */
    long expectedVersion() {
        List<InvalidRequestException> errors = new ArrayList<>();
        long expected = TransactionUpdateRequest.readVersion(version, errors);
        if (!errors.isEmpty()) {
            throw InvalidRequestException.ofAll(errors);
        }
        return expected;
    }
}
