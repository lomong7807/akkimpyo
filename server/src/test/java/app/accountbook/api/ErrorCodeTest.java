package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/** 프레임워크와 Tomcat이 상태로만 알린 오류를 ADR 002 5절의 code로 바꾸는 표. */
class ErrorCodeTest {

    @ParameterizedTest
    @CsvSource({
            "400, MALFORMED_REQUEST", "401, UNAUTHENTICATED", "403, FORBIDDEN", "404, NOT_FOUND",
            "405, METHOD_NOT_ALLOWED", "415, UNSUPPORTED_MEDIA_TYPE", "500, INTERNAL_ERROR",
            // 목록에 code가 없는 상태. 406 줄 수 없는 형식, 417 모르는 기대, 501 모르는 전송 방식, 505 모르는 HTTP 버전
            "406, MALFORMED_REQUEST", "417, MALFORMED_REQUEST", "431, MALFORMED_REQUEST",
            "501, MALFORMED_REQUEST", "505, MALFORMED_REQUEST",
            // 다시 보내면 될 수 있는 것은 5xx다(ADR 006 결정 6: code가 있는 4xx는 다시 보내지 않는다)
            "408, INTERNAL_ERROR", "503, INTERNAL_ERROR"})
    void 상태를_code로_바꾼다(int status, ErrorCode expected) {
        assertThat(ErrorCode.of(status)).isEqualTo(expected);
    }
}
