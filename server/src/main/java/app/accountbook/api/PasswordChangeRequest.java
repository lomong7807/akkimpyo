package app.accountbook.api;

import io.swagger.v3.oas.annotations.media.Schema;

/** 비밀번호 바꾸기의 본문(#31). 빠진 값과 규칙은 user가 모아 본다. */
record PasswordChangeRequest(
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, format = "password", accessMode = Schema.AccessMode.WRITE_ONLY)
        String currentPassword,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, format = "password", accessMode = Schema.AccessMode.WRITE_ONLY)
        String newPassword) {

    /** 스프링이 요청 객체를 로그에 남길 때 값이 나가지 않게 한다. */
    @Override
    public String toString() {
        return "PasswordChangeRequest[]";
    }
}
