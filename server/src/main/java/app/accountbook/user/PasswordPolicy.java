package app.accountbook.user;

import app.accountbook.common.InvalidRequestException;

/**
 * 비밀번호 규칙(P-101): 8자 이상 72자 이하(유니코드 글자 수)이고 영문(A-Z, a-z)과 숫자(0-9)를 모두 포함한다.
 * 비밀번호는 입력 그대로다. 앞뒤 공백을 지우지 않는다. 오류 문구에 입력값을 넣지 않는다.
 */
final class PasswordPolicy {

    static final int MIN_LENGTH = 8;
    static final int MAX_LENGTH = 72;

    private PasswordPolicy() {
    }

    /** 규칙에 맞지 않으면 {@link InvalidRequestException}. */
    static void validate(String password) {
        if (password == null || !hasValidLength(password)
                || password.chars().noneMatch(PasswordPolicy::isAsciiLetter)
                || password.chars().noneMatch(PasswordPolicy::isAsciiDigit)) {
            throw new InvalidRequestException(
                    "비밀번호는 " + MIN_LENGTH + "~" + MAX_LENGTH + "자이고 영문과 숫자를 모두 포함해야 합니다.");
        }
    }

    private static boolean hasValidLength(String password) {
        int length = password.codePointCount(0, password.length());
        return length >= MIN_LENGTH && length <= MAX_LENGTH;
    }

    private static boolean isAsciiLetter(int ch) {
        return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
    }

    private static boolean isAsciiDigit(int ch) {
        return ch >= '0' && ch <= '9';
    }
}
