package app.accountbook.common;

/**
 * 요청 값은 맞지만 대상의 지금 상태로는 할 수 없다("이미 삭제된 거래" 등). 아무것도 바꾸지 않는다.
 * API는 입력란 없이 409 {@code INVALID_STATE}로 답하고(ADR 002 5절) 문구는 응답에 싣지 않는다.
 * 요청 값이 틀린 것은 {@link InvalidRequestException}이다.
 */
public class InvalidStateException extends RuntimeException {

    public InvalidStateException(String message) {
        super(message);
    }
}
