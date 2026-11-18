package app.accountbook.common;

/** 계좌·카테고리 이름 규칙: 앞뒤 공백을 지운 뒤 1~50자. */
public final class Names {

    public static final int MAX_LENGTH = 50;

    private Names() {
    }

    /** 공백을 지운 이름을 돌려준다. 규칙에 맞지 않으면 {@link InvalidRequestException}. */
    public static String normalize(String raw) {
        String name = raw == null ? "" : raw.strip();
        int length = name.codePointCount(0, name.length());
        if (length < 1 || length > MAX_LENGTH) {
            throw new InvalidRequestException("이름은 앞뒤 공백을 뺀 1~" + MAX_LENGTH + "자여야 합니다.");
        }
        return name;
    }
}
