package app.accountbook.auth;

/** 로그인, 가입, 갱신이 주는 두 토큰. access token은 본문으로, refresh token은 쿠키로 나간다(ADR 001 결정 4, 6). */
public record LoginTokens(String accessToken, IssuedRefreshToken refreshToken) {

    /** 토큰이 로그에 찍히지 않게 값을 뺀다. */
    @Override
    public String toString() {
        return "LoginTokens[" + refreshToken + "]";
    }
}
