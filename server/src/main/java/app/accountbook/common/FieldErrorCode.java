package app.accountbook.common;

/** 입력란 오류의 종류(ADR 002 4절 {@code fieldErrors[].code}). 추가만 하고 뜻을 바꾸거나 없애지 않는다. */
public enum FieldErrorCode {
    REQUIRED,
    INVALID_FORMAT,
    OUT_OF_RANGE,
    TOO_LONG,
    DUPLICATE,
    /** 형식은 맞지만 규칙상 받을 수 없는 값이나 조합. */
    NOT_ALLOWED,
    /** 가리킨 계좌나 카테고리가 이 장부에 없다(그사이 지워진 것 포함). 404가 아니라 그 입력란의 오류다(#14). */
    NOT_FOUND,
    /** 고른 상위가 하위 카테고리다. 카테고리는 2단계까지다(P-221, #44). */
    TOO_DEEP,
    /** 고른 상위와 수입·지출 구분({@code kind})이 다르다(P-221, #44). */
    KIND_MISMATCH,
    /** 형식은 맞지만 저장된 값과 맞지 않는다. 현재 비밀번호가 틀렸다(#31). 401이 아니라 그 입력란의 오류다. */
    INCORRECT
}
