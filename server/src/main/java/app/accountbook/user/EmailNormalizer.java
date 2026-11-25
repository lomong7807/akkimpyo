package app.accountbook.user;

import app.accountbook.common.InvalidRequestException;
import java.util.Locale;

/**
 * 입력한 이메일을 저장하고 비교하는 값으로 맞춘다(P-101). 이메일을 받는 모든 곳이 이것을 거친다.
 * 순서: 앞뒤의 다섯 글자(U+0020, U+0009, U+000A, U+000C, U+000D)를 지운다 → 남은 값이 모두 ASCII 인쇄 가능 문자
 * (U+0021~U+007E)인지 본다 → 소문자로 바꾼다. 다른 공백은 앞뒤에 있어도 형식 오류다.
 */
final class EmailNormalizer {

    private EmailNormalizer() {
    }

    /**
     * 맞춘 이메일. 형식은 {@code @}가 정확히 하나이고 그 앞뒤가 비어 있지 않은지와
     * {@value User#EMAIL_MAX_LENGTH}자 이하인지만 본다. 아니면 {@link InvalidRequestException}이고 문구에 입력값을 넣지 않는다.
     * 돌려준 값은 DB의 ck_users_email_normalized, ck_users_email_length도 지난다.
     */
    static String normalize(String raw) {
        String trimmed = raw == null ? "" : trim(raw);
        // 소문자로 바꾸기 전에 본다. 바꾼 뒤에 보면 켈빈 기호(U+212A)가 ASCII k가 되어 통과한다.
        if (!trimmed.chars().allMatch(EmailNormalizer::isPrintableAscii)) {
            throw invalidFormat();
        }
        String email = trimmed.toLowerCase(Locale.ROOT);
        int at = email.indexOf('@');
        if (at < 1 || at == email.length() - 1 || at != email.lastIndexOf('@')) {
            throw invalidFormat();
        }
        if (email.length() > User.EMAIL_MAX_LENGTH) {
            throw new InvalidRequestException("이메일은 " + User.EMAIL_MAX_LENGTH + "자 이하여야 합니다.");
        }
        return email;
    }

    /** String.strip()과 trim()은 정해진 다섯 글자보다 많이 지워서 쓰지 않는다. */
    private static String trim(String raw) {
        int start = 0;
        int end = raw.length();
        while (start < end && isTrimmed(raw.charAt(start))) {
            start++;
        }
        while (end > start && isTrimmed(raw.charAt(end - 1))) {
            end--;
        }
        return raw.substring(start, end);
    }

    private static boolean isTrimmed(char ch) {
        return ch == ' ' || ch == '\t' || ch == '\n' || ch == '\f' || ch == '\r';
    }

    private static boolean isPrintableAscii(int ch) {
        return ch >= 0x21 && ch <= 0x7E;
    }

    private static InvalidRequestException invalidFormat() {
        return new InvalidRequestException("이메일 형식이 올바르지 않습니다.");
    }
}
