package app.accountbook.common;

/** 같은 이메일의 사용자가 이미 있다. */
public class DuplicateEmailException extends RuntimeException {

    public DuplicateEmailException() {
        super("이미 사용 중인 이메일입니다.");
    }
}
