package app.accountbook.api;

record AccessTokenResponse(String accessToken) {

    /** 스프링이 응답 객체를 로그에 남길 때 토큰이 나가지 않게 한다. */
    @Override
    public String toString() {
        return "AccessTokenResponse[]";
    }
}
