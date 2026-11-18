package app.accountbook.common;

/** 요청 값이 규칙에 맞지 않는다. 아무것도 저장하지 않는다. */
public class InvalidRequestException extends RuntimeException {

    public InvalidRequestException(String message) {
        super(message);
    }
}
