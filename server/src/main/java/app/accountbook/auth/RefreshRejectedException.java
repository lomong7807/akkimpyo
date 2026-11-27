package app.accountbook.auth;

/** 갱신 실패. 쿠키가 없거나, 모르는 값이거나, 만료·폐기·재사용인 것을 나누지 않는다. */
public class RefreshRejectedException extends RuntimeException {

    RefreshRejectedException() {
        super("refresh token을 쓸 수 없습니다.");
    }
}
