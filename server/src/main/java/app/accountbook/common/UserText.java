package app.accountbook.common;

import java.text.Normalizer;

/**
 * 사용자가 넣는 글자(계좌·카테고리 이름, 표시 이름, 가맹점/내용, 메모)를 저장하고 비교하는 값으로 맞추고 검사한다(P-214).
 * 이 글자를 받는 모든 곳이 저장과 비교보다 먼저 이것을 거친다. 비밀번호(NFKC)와 이메일(ASCII)은 대상이 아니다.
 *
 * <p>순서: 짝 없는 서로게이트 거부 → 거부 글자 검사 → 앞뒤 공백류 지우기(이름, 가맹점) → 조합형(NFC) → 글자 수(코드포인트).
 * 메모는 지우기 대신 {@code \r\n}과 {@code \r}을 {@code \n}으로 바꾸고, 그 뒤에 거부 글자를 본다.
 * <ul>
 *   <li>거부 글자: 제어 문자(Cc), U+2028, U+2029, 서식 문자(Cf), 보이지 않는 글자(U+034F, U+115F, U+1160, U+17B4,
 *       U+17B5, U+180B~U+180F, U+2800, U+3164, U+FFA0, U+FE00~U+FE0F, U+E0100~U+E01EF). 메모는 U+000A를 더 받는다.
 *   <li>예외는 이모지를 이루는 자리뿐이다. U+200D는 앞이 이모지(뒤에 피부색이나 U+FE0F가 하나 붙은 것 포함)이고 뒤가
 *       이모지일 때, U+FE0F는 이모지 바로 뒤이거나 {@code 0-9 # *}와 U+20E3 사이일 때. 이모지는
 *       {@link Character#isExtendedPictographic}이다.
 *   <li>공백류는 {@link #TRIMMED_SPACES}다. 탭과 줄바꿈은 공백류가 아니라 제어 문자라서 앞뒤에 있어도 거부한다.
 * </ul>
 * 거부는 입력란을 담은 {@link InvalidRequestException}이고 문구에 입력값을 넣지 않는다.
 * 돌려준 값은 DB의 이름 CHECK(ck_*_trimmed, ck_*_length)도 지난다.
 */
public final class UserText {

    /** 앞뒤에서 지우는 공백류 글자: 유니코드 Zs(공백 구분자) 17자. 거부 검사를 지나고 남는 공백이 이것뿐이다. */
    public static final String TRIMMED_SPACES = "          "
            + "      　";

    private static final String PAYEE_FIELD = "payee";
    private static final String MEMO_FIELD = "memo";

    private static final int ZERO_WIDTH_JOINER = 0x200D;
    private static final int EMOJI_PRESENTATION_SELECTOR = 0xFE0F;
    private static final int COMBINING_KEYCAP = 0x20E3;
    private static final int SKIN_TONE_FIRST = 0x1F3FB;
    private static final int SKIN_TONE_LAST = 0x1F3FF;

    private UserText() {
    }

    /**
     * 계좌·카테고리 이름과 표시 이름(P-101, P-220, P-221). 앞뒤 공백류를 지우고 NFC로 맞춘 1~maxLength자.
     * 거부 글자는 {@link FieldErrorCode#INVALID_FORMAT}, 비었으면 {@link FieldErrorCode#REQUIRED},
     * 길면 {@link FieldErrorCode#TOO_LONG}이다.
     *
     * @param field 요청 본문의 입력란(예: {@code name}, {@code displayName})
     */
    public static String name(String raw, int maxLength, String field) {
        String text = raw == null ? "" : raw;
        requireAllowed(text, false, field, "이름");
        String name = nfc(trimSpaces(text));
        if (name.isEmpty()) {
            throw new InvalidRequestException(field, FieldErrorCode.REQUIRED, "이름이 없습니다.");
        }
        requireMaxLength(name, maxLength, field, "이름은");
        return name;
    }

    /**
     * 가맹점/내용(P-214). 앞뒤 공백류를 지우고 NFC로 맞춘다. 비었거나 공백류뿐이면 값 없음({@code null})이다.
     * 입력란은 {@code payee}다.
     */
    public static String payee(String raw, int maxLength) {
        if (raw == null) {
            return null;
        }
        requireAllowed(raw, false, PAYEE_FIELD, "가맹점/내용");
        String payee = nfc(trimSpaces(raw));
        if (payee.isEmpty()) {
            return null;
        }
        requireMaxLength(payee, maxLength, PAYEE_FIELD, "가맹점/내용은");
        return payee;
    }

    /**
     * 메모(P-214). 앞뒤를 지우지 않는다. {@code \r\n}과 {@code \r}을 {@code \n}으로 바꾸고 NFC로 맞춘다.
     * 빈 문자열은 값 없음({@code null})이다. 입력란은 {@code memo}다.
     */
    public static String memo(String raw, int maxLength) {
        if (raw == null) {
            return null;
        }
        requireNoUnpairedSurrogate(raw, MEMO_FIELD, "메모");
        String memo = unifyLineBreaks(raw);
        requireAllowed(memo, true, MEMO_FIELD, "메모");
        memo = nfc(memo);
        if (memo.isEmpty()) {
            return null;
        }
        requireMaxLength(memo, maxLength, MEMO_FIELD, "메모는");
        return memo;
    }

    /**
     * 저장된 가맹점을 {@link #payee}와 같은 방식으로 맞춘 비교용 값. 이 규칙 전에 저장된 값에도 쓰므로 거부하지 않고 글자 수도
     * 보지 않는다. 재전송 비교(ADR 006 결정 3)가 요청과 저장된 값을 모두 같은 맞추기로 보게 한다.
     */
    public static String comparablePayee(String stored) {
        if (stored == null) {
            return null;
        }
        String payee = nfc(trimSpaces(stored));
        return payee.isEmpty() ? null : payee;
    }

    /** 저장된 메모를 {@link #memo}와 같은 방식으로 맞춘 비교용 값. 거부하지 않는다({@link #comparablePayee}와 같은 이유). */
    public static String comparableMemo(String stored) {
        if (stored == null) {
            return null;
        }
        String memo = nfc(unifyLineBreaks(stored));
        return memo.isEmpty() ? null : memo;
    }

    /** 짝 없는 서로게이트 → 거부 글자 순으로 본다. 짝 없는 서로게이트는 UTF-8로 저장할 수 없어 다른 글자로 바뀐다(#164). */
    private static void requireAllowed(String text, boolean lineFeedAllowed, String field, String label) {
        requireNoUnpairedSurrogate(text, field, label);
        int[] codePoints = text.codePoints().toArray();
        for (int i = 0; i < codePoints.length; i++) {
            int cp = codePoints[i];
            boolean allowedLineFeed = lineFeedAllowed && cp == '\n';
            if (!allowedLineFeed && isForbidden(cp) && !isPartOfEmoji(codePoints, i)) {
                throw new InvalidRequestException(field, FieldErrorCode.INVALID_FORMAT,
                        label + "에 쓸 수 없는 글자가 있습니다.");
            }
        }
    }

    private static void requireNoUnpairedSurrogate(String text, String field, String label) {
        // 짝이 맞는 서로게이트는 codePoints()에서 한 글자로 합쳐지고, 짝 없는 것만 서로게이트 값으로 남는다.
        if (text.codePoints().anyMatch(cp -> Character.getType(cp) == Character.SURROGATE)) {
            throw new InvalidRequestException(field, FieldErrorCode.INVALID_FORMAT,
                    label + "에 저장할 수 없는 글자(짝 없는 서로게이트)가 있습니다.");
        }
    }

    private static boolean isForbidden(int cp) {
        int type = Character.getType(cp);
        return type == Character.CONTROL || type == Character.FORMAT
                || cp == 0x2028 || cp == 0x2029
                || isInvisible(cp);
    }

    /** P-214의 보이지 않는 글자. Cf가 아니라서 따로 적는다. */
    private static boolean isInvisible(int cp) {
        return cp == 0x034F
                || cp == 0x115F || cp == 0x1160
                || cp == 0x17B4 || cp == 0x17B5
                || (cp >= 0x180B && cp <= 0x180F)
                || cp == 0x2800
                || cp == 0x3164
                || cp == 0xFFA0
                || (cp >= 0xFE00 && cp <= 0xFE0F)
                || (cp >= 0xE0100 && cp <= 0xE01EF);
    }

    /** 거부 글자 가운데 이모지를 이루는 자리의 U+200D와 U+FE0F. */
    private static boolean isPartOfEmoji(int[] codePoints, int i) {
        int cp = codePoints[i];
        boolean hasPrevious = i > 0;
        boolean hasNext = i + 1 < codePoints.length;
        if (cp == ZERO_WIDTH_JOINER) {
            return hasPrevious && hasNext && endsEmoji(codePoints, i - 1)
                    && Character.isExtendedPictographic(codePoints[i + 1]);
        }
        if (cp == EMOJI_PRESENTATION_SELECTOR) {
            return hasPrevious && (Character.isExtendedPictographic(codePoints[i - 1])
                    || (isKeycapBase(codePoints[i - 1]) && hasNext && codePoints[i + 1] == COMBINING_KEYCAP));
        }
        return false;
    }

    /** codePoints[end]에서 끝나는 이모지인가: 이모지 하나, 또는 이모지 뒤에 피부색이나 U+FE0F 하나. */
    private static boolean endsEmoji(int[] codePoints, int end) {
        int cp = codePoints[end];
        boolean modifier = (cp >= SKIN_TONE_FIRST && cp <= SKIN_TONE_LAST) || cp == EMOJI_PRESENTATION_SELECTOR;
        if (modifier) {
            return end > 0 && Character.isExtendedPictographic(codePoints[end - 1]);
        }
        return Character.isExtendedPictographic(cp);
    }

    private static boolean isKeycapBase(int cp) {
        return (cp >= '0' && cp <= '9') || cp == '#' || cp == '*';
    }

    /** 공백류는 모두 BMP 글자라 char 단위로 본다. String.strip()은 U+00A0 같은 줄바꿈 없는 공백을 지우지 않아 쓰지 않는다. */
    private static String trimSpaces(String text) {
        int start = 0;
        int end = text.length();
        while (start < end && TRIMMED_SPACES.indexOf(text.charAt(start)) >= 0) {
            start++;
        }
        while (end > start && TRIMMED_SPACES.indexOf(text.charAt(end - 1)) >= 0) {
            end--;
        }
        return text.substring(start, end);
    }

    private static String unifyLineBreaks(String text) {
        return text.replace("\r\n", "\n").replace('\r', '\n');
    }

    private static String nfc(String text) {
        return Normalizer.normalize(text, Normalizer.Form.NFC);
    }

    private static void requireMaxLength(String text, int maxLength, String field, String subject) {
        if (text.codePointCount(0, text.length()) > maxLength) {
            throw new InvalidRequestException(field, FieldErrorCode.TOO_LONG,
                    subject + " " + maxLength + "자까지 쓸 수 있습니다.");
        }
    }
}
