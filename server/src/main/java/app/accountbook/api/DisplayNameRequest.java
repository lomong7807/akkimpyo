package app.accountbook.api;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 표시 이름 바꾸기의 본문(#68). 빠진 값과 글자 규칙은 서비스가 가입과 같이 본다. 다른 칸(이메일 등)은 읽지 않는다.
 * 글자가 아닌 값은 스프링이 {@code displayName}의 형식 오류로 알린다(ADR 002 2절).
 */
record DisplayNameRequest(@Schema(requiredMode = Schema.RequiredMode.REQUIRED) String displayName) {

    /** 스프링이 요청 객체를 로그에 남길 때 이름이 나가지 않게 한다(ADR 001 결정 10). */
    @Override
    public String toString() {
        return "DisplayNameRequest[]";
    }
}
