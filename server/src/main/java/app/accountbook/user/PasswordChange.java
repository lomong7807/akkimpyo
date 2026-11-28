package app.accountbook.user;

import java.util.UUID;

/**
 * 비밀번호 바꾸기의 확인 결과(#31, ADR 001 결정 7). 확인할 때 본 저장값과 새 해시를 담아 auth의 트랜잭션에서
 * {@link UserService#changePassword}로 돌려준다. 둘은 user 밖에서 꺼낼 수 없다.
 */
public final class PasswordChange {

    private final UUID userId;
    private final String storedHash;
    private final String newHash;

    PasswordChange(UUID userId, String storedHash, String newHash) {
        this.userId = userId;
        this.storedHash = storedHash;
        this.newHash = newHash;
    }

    public UUID userId() {
        return userId;
    }

    String storedHash() {
        return storedHash;
    }

    String newHash() {
        return newHash;
    }

    @Override
    public String toString() {
        return "PasswordChange[userId=" + userId + "]";
    }
}
