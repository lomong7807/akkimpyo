package app.accountbook.common;

/**
 * 요청 값이 규칙에 맞지 않는다. 아무것도 저장하지 않는다.
 * API는 {@link #field()}와 {@link #code()}로 답하고(ADR 002의 {@code VALIDATION_FAILED}) 문구는 응답에 싣지 않는다.
 */
public class InvalidRequestException extends RuntimeException {

    /** 어느 입력란인지 정하지 않았거나 요청 본문 전체의 오류다. */
    private static final String WHOLE_BODY = "";

    private final String field;
    private final FieldErrorCode code;

    /** 어느 입력란인지 아직 정하지 않은 곳이 쓴다. 새 코드는 입력란을 담는 생성자를 쓴다. */
    public InvalidRequestException(String message) {
        this(WHOLE_BODY, FieldErrorCode.NOT_ALLOWED, message);
    }

    /** @param field 입력란. 요청 본문의 경로(예: {@code amount}, {@code lines[0].amount})다 */
    public InvalidRequestException(String field, FieldErrorCode code, String message) {
        super(message);
        this.field = field;
        this.code = code;
    }

    public String field() {
        return field;
    }

    public FieldErrorCode code() {
        return code;
    }
}
