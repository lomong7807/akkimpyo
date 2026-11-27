package app.accountbook.user;

import app.accountbook.common.InvalidRequestException;

/**
 * 비밀번호 규칙(P-101): NFKC로 맞춘 값이 8자 이상 72자 이하(유니코드 글자 수)이고 영문(A-Z, a-z)과 숫자(0-9)를 모두 포함한다.
 * 맞춘 값으로 보므로 전각 영문·숫자도 조건을 채운다. 앞뒤 공백을 지우지 않는다. 오류 문구에 입력값을 넣지 않는다.
 */
final class PasswordPolicy {

    static final int MIN_LENGTH = 8;
    static final int MAX_LENGTH = 72;

    private PasswordPolicy() {
    }

    /** 정규화한({@link PasswordNormalizer}) 비밀번호를 돌려준다. 규칙에 맞지 않으면 {@link InvalidRequestException}. */
    static String normalizeAndValidate(String raw) {
        return PasswordNormalizer.normalize(raw)
                .filter(PasswordPolicy::isAllowed)
                .orElseThrow(() -> new InvalidRequestException(
                        "비밀번호는 " + MIN_LENGTH + "~" + MAX_LENGTH + "자이고 영문과 숫자를 모두 포함해야 합니다."));
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

    private static boolean isAllowed(String password) {
        return hasValidLength(password)
                && password.chars().anyMatch(PasswordPolicy::isAsciiLetter)
                && password.chars().anyMatch(PasswordPolicy::isAsciiDigit);
    }

    private static boolean hasValidLength(String password) {
        int length = length(password);
        return length >= MIN_LENGTH && length <= MAX_LENGTH;
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
