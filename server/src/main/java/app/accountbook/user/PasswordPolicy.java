package app.accountbook.user;

import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;

/**
 * 비밀번호 규칙(P-101): NFKC로 맞춘 값이 8자 이상 72자 이하(유니코드 글자 수)이고 영문(A-Z, a-z)과 숫자(0-9)를 모두 포함한다.
 * 맞춘 값으로 보므로 전각 영문·숫자도 조건을 채운다. 앞뒤 공백을 지우지 않는다. 오류 문구에 입력값을 넣지 않는다.
 */
final class PasswordPolicy {

    static final int MIN_LENGTH = 8;
    static final int MAX_LENGTH = 72;

    private static final String FIELD = "password";

    private PasswordPolicy() {
    }

    /**
     * 정규화한({@link PasswordNormalizer}) 비밀번호. 규칙에 맞지 않으면 입력란 {@code password}의 {@link InvalidRequestException}:
     * 없거나 빈 글자는 REQUIRED, 정규화 전 512자나 정규화 뒤 72자를 넘으면 TOO_LONG, 나머지 규칙 오류는 INVALID_FORMAT.
     */
    static String normalizeAndValidate(String raw) {
        if (raw == null || raw.isEmpty()) {
            throw invalid(FieldErrorCode.REQUIRED);
        }
        // 정규화보다 먼저 본다. 정규화하지 못하는 나머지는 짝 없는 서로게이트다.
        if (raw.length() > PasswordNormalizer.MAX_RAW_LENGTH) {
            throw invalid(FieldErrorCode.TOO_LONG);
        }
        String password = PasswordNormalizer.normalize(raw).orElseThrow(() -> invalid(FieldErrorCode.INVALID_FORMAT));
        if (length(password) > MAX_LENGTH) {
            throw invalid(FieldErrorCode.TOO_LONG);
        }
        if (length(password) < MIN_LENGTH || password.chars().noneMatch(PasswordPolicy::isAsciiLetter)
                || password.chars().noneMatch(PasswordPolicy::isAsciiDigit)) {
            throw invalid(FieldErrorCode.INVALID_FORMAT);
        }
        return password;
    }

    /**
     * 저장된 비밀번호와 비교해 볼 입력인가. 정규화할 수 있고 정규화한 값이 {@value #MAX_LENGTH}자 이하다. 너무 긴 입력을 해시하지 않으려고 본다.
     * 나머지 규칙은 보지 않는다. 규칙을 바꿔도 전에 저장한 비밀번호로 로그인할 수 있어야 한다.
     */
    static boolean isComparable(String raw) {
        return PasswordNormalizer.normalize(raw)
                .filter(password -> length(password) <= MAX_LENGTH)
                .isPresent();
    }

    /** 문구는 하나다. 입력값을 넣지 않는다. */
    private static InvalidRequestException invalid(FieldErrorCode code) {
        return new InvalidRequestException(FIELD, code,
                "비밀번호는 " + MIN_LENGTH + "~" + MAX_LENGTH + "자이고 영문과 숫자를 모두 포함해야 합니다.");
    }

    private static int length(String password) {
        return password.codePointCount(0, password.length());
    }

    private static boolean isAsciiLetter(int ch) {
        return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
    }

    private static boolean isAsciiDigit(int ch) {
        return ch >= '0' && ch <= '9';
    }
}
