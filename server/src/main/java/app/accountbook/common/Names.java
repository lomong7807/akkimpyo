package app.accountbook.common;

/** 이름 규칙: 앞뒤 공백을 지운 뒤 1자 이상, 상한 이하(유니코드 글자 수 기준). 계좌는 50자, 카테고리는 20자다. */
public final class Names {

    public static final int MAX_LENGTH = 50;

    private Names() {
    }

    /** 공백을 지운 이름을 돌려준다. 1~{@value #MAX_LENGTH}자가 아니면 {@link InvalidRequestException}. */
    public static String normalize(String raw) {
        return normalize(raw, MAX_LENGTH);
    }

    /** 공백을 지운 이름을 돌려준다. 1~maxLength자가 아니면 {@link InvalidRequestException}. */
    public static String normalize(String raw, int maxLength) {
        String name = raw == null ? "" : raw.strip();
        int length = name.codePointCount(0, name.length());
        if (length < 1 || length > maxLength) {
            throw new InvalidRequestException("이름은 앞뒤 공백을 뺀 1~" + maxLength + "자여야 합니다.");
        }
        return name;
    }
}
