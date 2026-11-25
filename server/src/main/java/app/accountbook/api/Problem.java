package app.accountbook.api;

/** 오류 응답의 본문(ADR 002 4절). */
record Problem(String type, String title, int status, String detail, ErrorCode code, String requestId) {

    static Problem of(ErrorCode code, String requestId) {
        return new Problem("about:blank", code.status().getReasonPhrase(), code.status().value(), code.detail(), code,
                requestId);
    }
}
