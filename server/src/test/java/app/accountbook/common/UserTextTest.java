package app.accountbook.common;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

import java.text.Normalizer;
import java.util.List;
import java.util.function.Function;
import java.util.stream.IntStream;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * 사용자가 넣는 글자의 규칙(P-214, #123, #164). 순서: 짝 없는 서로게이트 거부 → 거부 글자 검사 → 앞뒤 공백류 지우기
 * (이름·가맹점) → NFC → 글자 수. 서비스마다 적용되는지와 DB 제약은 각 서비스의 *TextTest와 TextSchemaTest가 본다.
 * 스프링 컨텍스트 없이 돈다.
 */
class UserTextTest {

    private static final int NAME_MAX = 20;
    private static final int PAYEE_MAX = 100;
    private static final int MEMO_MAX = 500;
    private static final String FIELD = "name";

    private static final String ZWJ = "‍";
    private static final String VS16 = "️";
    private static final String KEYCAP = "⃣";
    private static final String FAMILY = "👨" + ZWJ + "👩" + ZWJ + "👧";

    /** 보이지 않는 글자(P-214)의 목록 그대로. 범위는 끝을 포함한다. */
    private static final List<int[]> INVISIBLE = List.of(
            new int[] {0x034F, 0x034F}, new int[] {0x115F, 0x1160}, new int[] {0x17B4, 0x17B5},
            new int[] {0x180B, 0x180F}, new int[] {0x2800, 0x2800}, new int[] {0x3164, 0x3164},
            new int[] {0xFFA0, 0xFFA0}, new int[] {0xFE00, 0xFE0F}, new int[] {0xE0100, 0xE01EF});

    // ---------------------------------------------------------------- 조합형(NFC)과 글자 수

    @Test
    void nameIsStoredInComposedForm() {
        String decomposed = nfd("식비");
        assertThat(decomposed).hasSize(5);

        assertThat(UserText.name(decomposed, NAME_MAX, FIELD)).isEqualTo("식비").hasSize(2);
    }

    @Test
    void lengthIsCountedAfterComposing() {
        // 분해형 한글 20자는 코드포인트로 60개지만 조합형 20자다.
        String decomposedTwenty = nfd("가각간갇갈감갑갓강갖갗같갚갛개객갠갤갬갭");
        assertThat(decomposedTwenty.codePointCount(0, decomposedTwenty.length())).isGreaterThan(NAME_MAX);

        assertThat(UserText.name(decomposedTwenty, NAME_MAX, FIELD)).hasSize(20);
        assertRejected(() -> UserText.name(nfd("가".repeat(21)), NAME_MAX, FIELD), FieldErrorCode.TOO_LONG);
    }

    @Test
    void lengthIsCountedInCodePoints() {
        String twentyEmoji = "😀".repeat(20);

        assertThat(UserText.name(twentyEmoji, NAME_MAX, FIELD)).isEqualTo(twentyEmoji);
        assertRejected(() -> UserText.name("😀".repeat(21), NAME_MAX, FIELD), FieldErrorCode.TOO_LONG);
    }

    // ---------------------------------------------------------------- 거부 글자

    @Test
    void everyControlCharacterIsRejected() {
        // Cc: U+0000~U+001F, U+007F~U+009F. U+0000은 PostgreSQL text에 담을 수 없어 거부하지 않으면 서버 오류가 된다.
        List<Integer> controls = IntStream.rangeClosed(0, 0x10FFFF)
                .filter(cp -> Character.getType(cp) == Character.CONTROL).boxed().toList();
        assertThat(controls).hasSize(65).contains(0x0000, 0x0009, 0x000A, 0x000D, 0x001F, 0x007F, 0x0085, 0x009F);

        controls.forEach(UserTextTest::assertRejectedEverywhereInName);
    }

    @Test
    void lineAndParagraphSeparatorsAreRejected() {
        assertRejectedEverywhereInName(0x2028);
        assertRejectedEverywhereInName(0x2029);
    }

    @Test
    void everyFormatCharacterIsRejected() {
        List<Integer> formats = IntStream.rangeClosed(0, 0x10FFFF)
                .filter(cp -> Character.getType(cp) == Character.FORMAT).boxed().toList();
        // 폭 없는 공백, 방향 제어, BOM, 단어 잇기, 태그 문자 같은 것이 들어 있는지 본다.
        assertThat(formats).contains(0x00AD, 0x061C, 0x180E, 0x200B, 0x200C, 0x200D, 0x200E, 0x200F, 0x202A,
                0x202E, 0x2060, 0x2066, 0x2069, 0xFEFF, 0xFFF9, 0xE0001, 0xE0020, 0xE007F);

        formats.forEach(UserTextTest::assertRejectedEverywhereInName);
    }

    @Test
    void everyListedInvisibleCharacterIsRejected() {
        INVISIBLE.forEach(range -> IntStream.rangeClosed(range[0], range[1])
                .forEach(UserTextTest::assertRejectedEverywhereInName));
    }

    @ParameterizedTest
    @ValueSource(strings = {"‍", "️", "ㅤ"})
    void nameEndingWithInvisibleCharacterIsRejected(String invisible) {
        assertRejected(() -> UserText.name("식비" + invisible, NAME_MAX, FIELD), FieldErrorCode.INVALID_FORMAT);
    }

    @Test
    void nameOfOnlyHangulFillerIsRejected() {
        // U+3164는 strip()으로 비지 않는 글자라 지우지 않고 거부한다.
        assertRejected(() -> UserText.name("ㅤ", NAME_MAX, FIELD), FieldErrorCode.INVALID_FORMAT);
        assertRejected(() -> UserText.name("ㅤㅤ", NAME_MAX, FIELD), FieldErrorCode.INVALID_FORMAT);
    }

    @Test
    void rejectionDoesNotEchoTheInput() {
        InvalidRequestException e = catchThrowableOfType(InvalidRequestException.class,
                () -> UserText.name("비밀이름​", NAME_MAX, "displayName"));

        assertThat(e.field()).isEqualTo("displayName");
        assertThat(e.code()).isEqualTo(FieldErrorCode.INVALID_FORMAT);
        assertThat(e.getMessage()).doesNotContain("비밀이름");
    }

    // ---------------------------------------------------------------- 이모지를 이루는 자리의 예외

    @ParameterizedTest
    @ValueSource(strings = {
            FAMILY,                                             // 가족: 이모지 U+200D 이모지 U+200D 이모지
            "1" + VS16 + KEYCAP, "#" + VS16 + KEYCAP, "*" + VS16 + KEYCAP, "0" + VS16 + KEYCAP, "9" + VS16 + KEYCAP,
            "❤" + VS16,                                    // ❤️ 이모지 바로 뒤의 U+FE0F
            "❤" + VS16 + ZWJ + "🔥",             // ❤️‍🔥 U+FE0F가 붙은 이모지 뒤의 U+200D
            "🧑🏽" + ZWJ + "💻",  // 🧑🏽‍💻 피부색이 붙은 이모지 뒤의 U+200D
            "🏳" + VS16 + ZWJ + "🌈",       // 🏳️‍🌈
            "🏃🏽" + ZWJ + "♂" + VS16, // 🏃🏽‍♂️ 피부색 뒤 U+200D, 이모지 뒤 U+FE0F
            "👍🏽",                         // 👍🏽 피부색만
            "🇰🇷",                         // 🇰🇷 국기(지역 표시 글자 둘)
            "1" + KEYCAP})                                      // U+FE0F 없는 키캡
    void emojiSequencesAreKept(String emoji) {
        assertThat(UserText.name("가족 " + emoji, NAME_MAX, FIELD)).isEqualTo("가족 " + emoji);
        assertThat(UserText.name(emoji, NAME_MAX, FIELD)).isEqualTo(emoji);
        assertThat(UserText.payee(emoji + "카페", PAYEE_MAX)).isEqualTo(emoji + "카페");
        assertThat(UserText.memo(emoji + "\n" + emoji, MEMO_MAX)).isEqualTo(emoji + "\n" + emoji);
    }

    @ParameterizedTest
    @ValueSource(strings = {
            ZWJ + "😀",                    // 앞이 없다
            "😀" + ZWJ,                    // 뒤가 없다
            "식" + ZWJ + "😀",             // 앞이 이모지가 아니다
            "😀" + ZWJ + "식",             // 뒤가 이모지가 아니다
            "😀" + ZWJ + ZWJ + "😀",       // 겹친 U+200D
            "😀" + VS16 + VS16,            // 겹친 U+FE0F
            "식" + VS16,                   // 이모지가 아닌 글자 뒤
            "1" + VS16,                    // 키캡이 아닌 숫자 뒤
            "a" + VS16 + KEYCAP,           // 0-9 # * 가 아닌 글자와 U+20E3 사이
            "👍🏽" + VS16, // 피부색 뒤의 U+FE0F
            "❤︎",                // 글자 모양 선택자(U+FE0E)는 이모지 뒤여도 거부한다
            "😀" + VS16 + "︁",         // 다른 변형 선택자
            // 잉글랜드 깃발: 태그 문자(Cf)라 거부한다(받아들임, security)
            "🏴󠁧󠁢󠁥󠁮󠁧󠁿"})
    void joinerAndSelectorOutsideEmojiAreRejected(String text) {
        assertRejected(() -> UserText.name(text, NAME_MAX, FIELD), FieldErrorCode.INVALID_FORMAT);
        assertRejected(() -> UserText.payee(text, PAYEE_MAX), FieldErrorCode.INVALID_FORMAT);
        assertRejected(() -> UserText.memo(text, MEMO_MAX), FieldErrorCode.INVALID_FORMAT);
    }

    // ---------------------------------------------------------------- 짝 없는 서로게이트(#164)

    @ParameterizedTest
    @ValueSource(strings = {
            "\uD800식비", "식\uD800비", "식비\uD800",   // 앞(high)만: 처음, 가운데, 끝
            "\uDC00식비", "식\uDC00비", "식비\uDC00",   // 뒤(low)만: 처음, 가운데, 끝
            "식\uDE00\uD83D비",                         // 순서가 뒤집힌 짝
            "\uD800", "a\uD800b"})
    void unpairedSurrogateIsRejectedEverywhere(String text) {
        assertRejected(() -> UserText.name(text, NAME_MAX, FIELD), FieldErrorCode.INVALID_FORMAT);
        assertRejected(() -> UserText.payee(text, PAYEE_MAX), FieldErrorCode.INVALID_FORMAT);
        // 메모도 예외가 없다.
        assertRejected(() -> UserText.memo(text, MEMO_MAX), FieldErrorCode.INVALID_FORMAT);
    }

    @Test
    void unpairedSurrogateIsRejectedBeforeLengthIsCounted() {
        // 글자 수를 넘는 값이어도 서로게이트 오류다. 검사가 글자 수보다 먼저다.
        assertRejected(() -> UserText.name("가".repeat(30) + "\uD800", NAME_MAX, FIELD),
                FieldErrorCode.INVALID_FORMAT);
    }

    @Test
    void pairedSurrogatesAreKept() {
        assertThat(UserText.name("😀식비", NAME_MAX, FIELD)).isEqualTo("😀식비");
        assertThat(UserText.payee("a😀b", PAYEE_MAX)).isEqualTo("a😀b");
        assertThat(UserText.memo("a😀b", MEMO_MAX)).isEqualTo("a😀b");
    }

    // ---------------------------------------------------------------- 앞뒤 공백류

    @Test
    void trimmedSpacesAreExactlyTheSpaceSeparatorsOfJava() {
        String spaceSeparators = IntStream.rangeClosed(0, 0x10FFFF)
                .filter(cp -> Character.getType(cp) == Character.SPACE_SEPARATOR)
                .collect(StringBuilder::new, StringBuilder::appendCodePoint, StringBuilder::append).toString();

        assertThat(UserText.TRIMMED_SPACES).isEqualTo(spaceSeparators).hasSize(17).contains(" ", "　");
    }

    @Test
    void everySpaceAroundNameIsTrimmedAndInnerSpaceIsKept() {
        UserText.TRIMMED_SPACES.chars().forEach(space -> {
            String s = Character.toString(space);
            // 가운데의 U+2000, U+2001은 NFC에서 U+2002, U+2003이 된다.
            assertThat(UserText.name(s + s + "식" + s + "비" + s, NAME_MAX, FIELD)).isEqualTo(nfc("식" + s + "비"));
        });
    }

    @Test
    void nameOfOnlySpacesIsRequired() {
        assertRejected(() -> UserText.name(UserText.TRIMMED_SPACES, NAME_MAX, FIELD), FieldErrorCode.REQUIRED);
        assertRejected(() -> UserText.name(" ", NAME_MAX, FIELD), FieldErrorCode.REQUIRED);
        assertRejected(() -> UserText.name("　　", NAME_MAX, FIELD), FieldErrorCode.REQUIRED);
        assertRejected(() -> UserText.name("", NAME_MAX, FIELD), FieldErrorCode.REQUIRED);
        assertRejected(() -> UserText.name(null, NAME_MAX, FIELD), FieldErrorCode.REQUIRED);
    }

    @Test
    void controlCharacterAtTheEdgeIsRejectedNotTrimmed() {
        // 거부 검사가 지우기보다 먼저다. 탭과 줄바꿈은 공백류가 아니라 제어 문자다.
        assertRejected(() -> UserText.name("식비\t", NAME_MAX, FIELD), FieldErrorCode.INVALID_FORMAT);
        assertRejected(() -> UserText.name("\n식비", NAME_MAX, FIELD), FieldErrorCode.INVALID_FORMAT);
        assertRejected(() -> UserText.name("\t\n", NAME_MAX, FIELD), FieldErrorCode.INVALID_FORMAT);
    }

    @Test
    void lengthIsCountedAfterTrimming() {
        assertThat(UserText.name("　" + "가".repeat(20) + " ", NAME_MAX, FIELD)).isEqualTo("가".repeat(20));
    }

    // ---------------------------------------------------------------- 가맹점

    @Test
    void payeeIsTrimmedAndComposed() {
        assertThat(UserText.payee("　 " + nfd("김밥천국") + " ", PAYEE_MAX)).isEqualTo("김밥천국");
        assertThat(UserText.payee("김밥 천국", PAYEE_MAX)).isEqualTo("김밥 천국");
    }

    @Test
    void emptyOrBlankPayeeIsStoredAsNothing() {
        assertThat(UserText.payee(null, PAYEE_MAX)).isNull();
        assertThat(UserText.payee("", PAYEE_MAX)).isNull();
        assertThat(UserText.payee("   ", PAYEE_MAX)).isNull();
        assertThat(UserText.payee(UserText.TRIMMED_SPACES, PAYEE_MAX)).isNull();
    }

    @Test
    void payeeLengthIsCountedAfterComposing() {
        assertThat(UserText.payee(nfd("가".repeat(100)), PAYEE_MAX)).hasSize(100);
        assertRejected(() -> UserText.payee("가".repeat(101), PAYEE_MAX), FieldErrorCode.TOO_LONG);
    }

    @Test
    void payeeRejectionNamesThePayeeField() {
        InvalidRequestException e = catchThrowableOfType(InvalidRequestException.class,
                () -> UserText.payee("a\uD800b", PAYEE_MAX));

        assertThat(e.field()).isEqualTo("payee");
        assertThat(e.code()).isEqualTo(FieldErrorCode.INVALID_FORMAT);
        assertThat(catchThrowableOfType(InvalidRequestException.class,
                () -> UserText.payee("가".repeat(101), PAYEE_MAX)).field()).isEqualTo("payee");
    }

    @ParameterizedTest
    @ValueSource(strings = {"\t", "\n", "\r", "\u0000", "\u0085", " ", "​", "‮", "ㅤ"})
    void payeeRejectsTheSameCharactersAsNames(String forbidden) {
        assertRejected(() -> UserText.payee("김밥" + forbidden + "천국", PAYEE_MAX), FieldErrorCode.INVALID_FORMAT);
    }

    // ---------------------------------------------------------------- 메모

    @Test
    void memoKeepsLineFeedAndConvertsOtherLineEndings() {
        assertThat(UserText.memo("점심\n저녁", MEMO_MAX)).isEqualTo("점심\n저녁");
        assertThat(UserText.memo("점심\r\n저녁", MEMO_MAX)).isEqualTo("점심\n저녁");
        assertThat(UserText.memo("점심\r저녁", MEMO_MAX)).isEqualTo("점심\n저녁");
        assertThat(UserText.memo("a\r\n\rb\n\r\nc\r", MEMO_MAX)).isEqualTo("a\n\nb\n\nc\n");
    }

    @Test
    void memoIsNotTrimmed() {
        assertThat(UserText.memo("  점심 　", MEMO_MAX)).isEqualTo("  점심 　");
        assertThat(UserText.memo("   ", MEMO_MAX)).isEqualTo("   ");
        assertThat(UserText.memo("\n점심\n", MEMO_MAX)).isEqualTo("\n점심\n");
    }

    @Test
    void emptyMemoIsStoredAsNothing() {
        assertThat(UserText.memo(null, MEMO_MAX)).isNull();
        assertThat(UserText.memo("", MEMO_MAX)).isNull();
    }

    @Test
    void memoIsComposed() {
        assertThat(UserText.memo(nfd("떡볶이\n순대"), MEMO_MAX)).isEqualTo("떡볶이\n순대");
    }

    @Test
    void memoLengthIsCountedAfterConvertingAndComposing() {
        // \r\n 250개는 바꾸면 \n 250개다.
        assertThat(UserText.memo("\r\n".repeat(250) + nfd("가".repeat(250)), MEMO_MAX)).hasSize(500);
        assertRejected(() -> UserText.memo("가".repeat(501), MEMO_MAX), FieldErrorCode.TOO_LONG);
    }

    @ParameterizedTest
    @ValueSource(strings = {"\t", "\u000B", "\u000C", "\u0000", "\u007F", "\u0085", " ", " ", "​",
            "‎", "﻿", "ㅤ", "⠀", "︀"})
    void memoAllowsOnlyLineFeedBeyondNames(String forbidden) {
        InvalidRequestException e = catchThrowableOfType(InvalidRequestException.class,
                () -> UserText.memo("점심" + forbidden + "저녁", MEMO_MAX));

        assertThat(e).isNotNull();
        assertThat(e.field()).isEqualTo("memo");
        assertThat(e.code()).isEqualTo(FieldErrorCode.INVALID_FORMAT);
    }

    // ---------------------------------------------------------------- 저장된 값의 비교용 맞추기

    @Test
    void storedPayeeIsAlignedTheSameWayWithoutRejecting() {
        assertThat(UserText.comparablePayee(" " + nfd("김밥천국") + " ")).isEqualTo("김밥천국");
        assertThat(UserText.comparablePayee("")).isNull();
        assertThat(UserText.comparablePayee("　")).isNull();
        assertThat(UserText.comparablePayee(null)).isNull();
        // 이 규칙 전에 저장된 거부 글자는 지우지 않고 그대로 둔다. 비교에서 다른 값이 될 뿐 오류가 아니다.
        assertThat(UserText.comparablePayee("김밥​천국")).isEqualTo("김밥​천국");
    }

    @Test
    void storedMemoIsAlignedTheSameWayWithoutRejecting() {
        assertThat(UserText.comparableMemo(nfd("점심") + "\r\n")).isEqualTo("점심\n");
        assertThat(UserText.comparableMemo(" 점심 ")).isEqualTo(" 점심 ");
        assertThat(UserText.comparableMemo("")).isNull();
        assertThat(UserText.comparableMemo(null)).isNull();
        assertThat(UserText.comparableMemo("점심\t저녁")).isEqualTo("점심\t저녁");
    }

    @Test
    void comparableValueOfAcceptedInputIsTheInputItself() {
        List.of("김밥천국", "김밥 천국", FAMILY, "1" + VS16 + KEYCAP).forEach(payee ->
                assertThat(UserText.comparablePayee(UserText.payee(payee, PAYEE_MAX)))
                        .isEqualTo(UserText.payee(payee, PAYEE_MAX)));
        List.of(" 점심\n", "\n", "   ").forEach(memo ->
                assertThat(UserText.comparableMemo(UserText.memo(memo, MEMO_MAX)))
                        .isEqualTo(UserText.memo(memo, MEMO_MAX)));
    }

    // ---------------------------------------------------------------- 도우미

    private static void assertRejectedEverywhereInName(int codePoint) {
        String ch = Character.toString(codePoint);
        String label = String.format("U+%04X", codePoint);
        List<Function<String, String>> positions = List.of(c -> c + "식비", c -> "식" + c + "비", c -> "식비" + c);
        positions.forEach(position -> {
            InvalidRequestException e = catchThrowableOfType(InvalidRequestException.class,
                    () -> UserText.name(position.apply(ch), NAME_MAX, FIELD));
            assertThat(e).as(label).isNotNull();
            assertThat(e.code()).as(label).isEqualTo(FieldErrorCode.INVALID_FORMAT);
            assertThat(e.field()).as(label).isEqualTo(FIELD);
        });
    }

    private static void assertRejected(ThrowingCallable call, FieldErrorCode code) {
        InvalidRequestException e = catchThrowableOfType(InvalidRequestException.class, call);
        assertThat(e).isNotNull();
        assertThat(e.code()).isEqualTo(code);
    }

    private static String nfd(String text) {
        return Normalizer.normalize(text, Normalizer.Form.NFD);
    }

    private static String nfc(String text) {
        return Normalizer.normalize(text, Normalizer.Form.NFC);
    }
}
