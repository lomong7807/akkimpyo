package app.accountbook.api;

import app.accountbook.common.InvalidRequestException;
import java.util.ArrayList;
import java.util.List;
import tools.jackson.databind.JsonNode;

/**
 * 내용 없이 version만 보내는 거래 동작의 본문: {@code { "version": N }}. 되살리기(#38), 완전히 지우기(#45), 승인취소·취소 되돌리기(#37)가 쓴다.
 * 그 밖의 칸은 읽지 않는다.
 *
 * @param version 동작하기 전에 본 그 거래의 version
 */
record TransactionVersionRequest(JsonNode version) {

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
