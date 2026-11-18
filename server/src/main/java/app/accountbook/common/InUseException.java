package app.accountbook.common;

/** 다른 데이터가 참조하고 있어 지울 수 없다. */
public class InUseException extends RuntimeException {

    public InUseException(String message) {
        super(message);
    }
}
