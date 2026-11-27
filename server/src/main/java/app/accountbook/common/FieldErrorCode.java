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
    NOT_FOUND
}
