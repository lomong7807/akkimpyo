package app.accountbook.api;

import io.swagger.v3.oas.annotations.media.Schema;

/** 빠진 값도 형식과 함께 서비스가 입력란마다 본다. 여러 칸이 틀리면 모두 알려야 해서 여기서 먼저 거르지 않는다(#29). */
record SignupRequest(
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String email,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, format = "password", accessMode = Schema.AccessMode.WRITE_ONLY) String password,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String displayName) {

    /** 스프링이 요청 객체를 로그에 남길 때 값이 나가지 않게 한다. */
    @Override
    public String toString() {
        return "SignupRequest[]";
    }
}
