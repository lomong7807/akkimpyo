package app.accountbook.user;

/** 동시에 도는 비밀번호 해시가 상한에 차 있고, 기다리는 동안 자리가 나지 않았거나 기다리는 요청도 상한에 찼다. 아무것도 저장하지 않는다. */
public class PasswordHashBusyException extends RuntimeException {

    PasswordHashBusyException() {
        super("지금 요청이 많습니다. 잠시 뒤 다시 시도해 주세요.");
    }
}
