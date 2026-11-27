package app.accountbook.auth;

/** 로그인 실패. 이메일과 비밀번호 중 무엇이 틀렸는지 나누지 않는다(P-105). */
public class InvalidCredentialsException extends RuntimeException {

    InvalidCredentialsException() {
        super("이메일 또는 비밀번호가 맞지 않습니다.");
    }
}
