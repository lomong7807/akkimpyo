package app.accountbook.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.accountbook.common.InvalidRequestException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * 이메일 정규화(P-101): 앞뒤의 정해진 다섯 글자를 지운다 → 남은 값이 ASCII 인쇄 가능 문자뿐인지 본다 → 소문자로 바꾼다.
 * 저장과 중복 검사는 UserServiceTest가 본다. 스프링 컨텍스트 없이 돈다.
 */
class EmailNormalizerTest {

    private static final String EMAIL = "owner@example.com";
    private static final String FORMAT_ERROR = "이메일 형식이 올바르지 않습니다.";

    // --- 앞뒤의 다섯 글자(U+0020, U+0009, U+000A, U+000C, U+000D)는 지운다 ---

    @ParameterizedTest
    @ValueSource(strings = {"0020", "0009", "000A", "000C", "000D"})
    void trimsEachOfTheFiveSpacesAroundEmail(String codePoint) {
        String space = character(codePoint);

        assertThat(EmailNormalizer.normalize(space + EMAIL)).isEqualTo(EMAIL);
        assertThat(EmailNormalizer.normalize(EMAIL + space)).isEqualTo(EMAIL);
        assertThat(EmailNormalizer.normalize(space.repeat(3) + EMAIL + space.repeat(2))).isEqualTo(EMAIL);
    }

    @Test
    void trimsMixedSpacesAroundEmail() {
        assertThat(EmailNormalizer.normalize(" \t\n\f\r" + EMAIL + "\r\n\f\t ")).isEqualTo(EMAIL);
    }

    // --- 다른 공백과 보이지 않는 글자는 앞뒤에 있어도 지우지 않고 형식 오류다 ---

    @ParameterizedTest
    @ValueSource(strings = {
            "000B", "001C", "001D", "001E", "001F",                 // 제어 문자인 공백
            "00A0", "FEFF", "3000",                                 // 줄바꿈 없는 공백, BOM, 전각 공백
            "0000", "007F", "0085", "1680", "2003", "2028", "202F", // 그 밖의 제어 문자와 공백
            "200B"})
    void rejectsOtherSpacesAroundEmail(String codePoint) {
        String space = character(codePoint);

        assertFormatError(space + EMAIL);
        assertFormatError(EMAIL + space);
        // 지우는 글자의 안쪽에 있어도 같다.
        assertFormatError(" " + space + EMAIL);
        assertFormatError(EMAIL + space + " ");
    }

    @ParameterizedTest
    @ValueSource(strings = {"0020", "0009", "000A", "000C", "000D"})
    void rejectsTheFiveSpacesInTheMiddle(String codePoint) {
        assertFormatError("ow" + character(codePoint) + "ner@example.com");
        assertFormatError("owner@exam" + character(codePoint) + "ple.com");
    }

    // --- 지운 뒤에 ASCII를 보고, 그 뒤에 소문자로 바꾼다 ---

    @Test
    void rejectsKelvinSignThatLowercasesToAsciiLetter() {
        // 소문자로 먼저 바꾸면 U+212A가 ASCII k가 되어 남의 주소와 같은 값이 된다.
        assertFormatError("\u212Aim@example.com");
    }

    @Test
    void lowercasesAfterTrimming() {
        assertThat(EmailNormalizer.normalize(" \tOwner@Example.COM\r\n")).isEqualTo(EMAIL);
    }

    // --- 비어 있는 값과 형식 ---

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {"", " ", "\t", "\n", "\f", "\r", " \t\n\f\r ", " @ ", "\towner@\n", " @example.com "})
    void rejectsEmptyOrOneSidedEmail(String raw) {
        assertFormatError(raw);
    }

    // --- 길이는 지운 뒤에 본다 ---

    @Test
    void countsLengthAfterTrimming() {
        String domain = "@example.com";
        String longest = "a".repeat(User.EMAIL_MAX_LENGTH - domain.length()) + domain;

        assertThat(EmailNormalizer.normalize("\r\n " + longest + " \t")).isEqualTo(longest);
        assertThatThrownBy(() -> EmailNormalizer.normalize(" a" + longest + " "))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessage("이메일은 254자 이하여야 합니다.");
    }

    /** 문구를 글자 그대로 고정한다. 입력값이 들어가면 실패한다. */
    private static void assertFormatError(String raw) {
        assertThatThrownBy(() -> EmailNormalizer.normalize(raw))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessage(FORMAT_ERROR);
    }

    private static String character(String codePoint) {
        return Character.toString(Integer.parseInt(codePoint, 16));
    }
}
