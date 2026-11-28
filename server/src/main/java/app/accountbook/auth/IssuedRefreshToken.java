package app.accountbook.auth;

import java.time.Instant;
import java.util.UUID;

/**
 * 새로 준 refresh token.
 *
 * @param value     쿠키에 넣을 값. 서버에는 해시만 남는다. 로그와 예외에 넣지 않는다(ADR 001 결정 10)
 * @param userId    계열의 사용자
 * @param expiresAt 이 값을 쓸 수 있는 마지막 시각(그 시각부터 거부). 준 때부터 30일이고 계열의 절대 만료를 넘지 않는다
 */
public record IssuedRefreshToken(String value, UUID userId, Instant expiresAt) {

    /** 값이 실수로 로그에 찍히지 않게 값을 뺀다. */
    @Override
    public String toString() {
        return "IssuedRefreshToken[userId=" + userId + ", expiresAt=" + expiresAt + "]";
    }
}
