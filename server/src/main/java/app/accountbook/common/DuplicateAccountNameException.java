package app.accountbook.common;

/** 같은 장부에 같은 이름의 계좌가 이미 있다. */
public class DuplicateAccountNameException extends RuntimeException {

    public DuplicateAccountNameException() {
        super("같은 이름의 계좌가 있습니다.");
    }
}
