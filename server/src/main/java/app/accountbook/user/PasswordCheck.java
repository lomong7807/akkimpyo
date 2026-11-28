package app.accountbook.user;

import java.util.UUID;

/**
 * 로그인의 비밀번호 확인 결과(ADR 001 결정 7). 확인할 때 본 저장값을 담고, 계열을 만드는 트랜잭션에서
 * {@link UserService#lockUnchanged}로 그 값이 그대로인지 다시 본다. 저장값은 user 밖에서 꺼낼 수 없다.
 */
public final class PasswordCheck {

    private final UUID userId;
    private final String storedHash;

    PasswordCheck(UUID userId, String storedHash) {
        this.userId = userId;
        this.storedHash = storedHash;
    }

    public UUID userId() {
        return userId;
    }

    String storedHash() {
        return storedHash;
    }

    @Override
    public String toString() {
        return "PasswordCheck[userId=" + userId + "]";
    }
}
