package app.accountbook.api;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;

/** 빠진 값만 본다. 형식과 길이가 틀린 것은 다른 로그인 실패와 같은 응답이라 여기서 나누지 않는다(P-105). */
record LoginRequest(@NotBlank String email,
                    @Schema(format = "password", accessMode = Schema.AccessMode.WRITE_ONLY) @NotEmpty String password) {

    /** 스프링이 요청 객체를 로그에 남길 때 값이 나가지 않게 한다. */
    @Override
    public String toString() {
        return "LoginRequest[]";
    }
}
