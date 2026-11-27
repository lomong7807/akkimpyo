package app.accountbook.api;

import app.accountbook.common.FieldErrorCode;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

/**
 * 오류 응답의 본문(ADR 002 4절). {@code fieldErrors}와 {@code current}는 해당할 때만 나간다.
 *
 * @param current 서버의 지금 자원. 응답의 자원과 같은 모양이다
 */
record Problem(String type, String title, int status, String detail, ErrorCode code, String requestId,
               @JsonInclude(JsonInclude.Include.NON_EMPTY) List<InvalidField> fieldErrors,
               @JsonInclude(JsonInclude.Include.NON_NULL) Object current) {

    static Problem of(ErrorCode code, String requestId) {
        return of(code, requestId, List.of());
    }

    static Problem of(ErrorCode code, String requestId, List<InvalidField> fieldErrors) {
        return of(code, requestId, fieldErrors, null);
    }

    static Problem of(ErrorCode code, String requestId, List<InvalidField> fieldErrors, Object current) {
        return new Problem("about:blank", code.status().getReasonPhrase(), code.status().value(), code.detail(), code,
                requestId, fieldErrors, current);
    }

    /** @param field 요청 본문의 경로나 쿼리 이름. 본문 전체의 오류이면 빈 글자다 */
    record InvalidField(String field, FieldErrorCode code, String message) {

        static InvalidField of(String field, FieldErrorCode code) {
            return new InvalidField(field, code, message(code));
        }

        /** 개발자가 읽는 글이고 고정이다. 요청으로 받은 값이 섞이지 않게 예외의 문구를 쓰지 않는다. */
        private static String message(FieldErrorCode code) {
            return switch (code) {
                case REQUIRED -> "값이 있어야 한다";
                case INVALID_FORMAT -> "형식이 맞지 않는다";
                case OUT_OF_RANGE -> "허용 범위를 벗어났다";
                case TOO_LONG -> "허용 길이를 넘었다";
                case DUPLICATE -> "이미 쓰이고 있는 값이다";
                case NOT_ALLOWED -> "받을 수 없는 값이다";
                case NOT_FOUND -> "가리킨 대상이 없다";
                case TOO_DEEP -> "더 깊이 둘 수 없다";
                case TYPE_MISMATCH -> "구분이 맞지 않는다";
            };
        }
    }
}
