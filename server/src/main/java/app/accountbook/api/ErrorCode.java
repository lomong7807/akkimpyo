package app.accountbook.api;

import org.springframework.http.HttpStatus;

/**
 * 오류의 종류와 그 상태(ADR 002 5절). 추가만 하고 뜻을 바꾸거나 없애지 않는다.
 * 문구는 고정이다. 요청으로 받은 값을 넣지 않는다.
 */
enum ErrorCode {
    VALIDATION_FAILED(HttpStatus.BAD_REQUEST, "요청의 값이 규칙에 맞지 않는다"),
    MALFORMED_REQUEST(HttpStatus.BAD_REQUEST, "요청을 읽을 수 없다"),
    NOT_FOUND(HttpStatus.NOT_FOUND, "대상을 찾을 수 없다"),
    METHOD_NOT_ALLOWED(HttpStatus.METHOD_NOT_ALLOWED, "이 경로에서 받지 않는 메서드다"),
    PAYLOAD_TOO_LARGE(HttpStatus.CONTENT_TOO_LARGE, "요청 본문이 너무 크다"),
    UNSUPPORTED_MEDIA_TYPE(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "지원하지 않는 Content-Type이다"),
    TOO_MANY_REQUESTS(HttpStatus.TOO_MANY_REQUESTS, "요청이 많아 지금은 처리할 수 없다"),
    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "서버에서 오류가 났다");

    private final HttpStatus status;
    private final String detail;

    ErrorCode(HttpStatus status, String detail) {
        this.status = status;
        this.detail = detail;
    }

    HttpStatus status() {
        return status;
    }

    String detail() {
        return detail;
    }

    /**
     * 프레임워크와 Tomcat이 상태로만 알린 오류의 종류. 밖으로 나가는 상태는 언제나 여기 있는 것이다.
     * 본문을 다 받지 못한 것(408)은 다시 보내면 될 수 있으므로 5xx로 답한다. code가 있는 4xx는 화면이 다시 보내지 않는다
     * (ADR 006 결정 6). 모르는 전송 방식(501)과 HTTP 버전(505)은 요청의 잘못이다.
     */
    static ErrorCode of(int status) {
        return switch (status) {
            case 404 -> NOT_FOUND;
            case 405 -> METHOD_NOT_ALLOWED;
            case 413 -> PAYLOAD_TOO_LARGE;
            case 415 -> UNSUPPORTED_MEDIA_TYPE;
            case 408 -> INTERNAL_ERROR;
            case 501, 505 -> MALFORMED_REQUEST;
            default -> status >= 400 && status < 500 ? MALFORMED_REQUEST : INTERNAL_ERROR;
        };
    }
}
