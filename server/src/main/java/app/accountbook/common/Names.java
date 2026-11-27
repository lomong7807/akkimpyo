package app.accountbook.common;

/**
 * 이름 규칙: P-214의 글자 규칙({@link UserText#name})으로 맞춘 1자 이상, 상한 이하(조합형으로 센 유니코드 글자 수).
 * 계좌는 50자, 카테고리와 표시 이름은 20자다. 입력란을 따로 주지 않으면 {@code name}이다.
 */
public final class Names {

    public static final int MAX_LENGTH = 50;

    private static final String FIELD = "name";

    private Names() {
    }

    /** 맞춘 이름을 돌려준다. 1~{@value #MAX_LENGTH}자가 아니거나 쓸 수 없는 글자가 있으면 {@link InvalidRequestException}. */
    public static String normalize(String raw) {
        return normalize(raw, MAX_LENGTH);
    }

    /** 맞춘 이름을 돌려준다. 1~maxLength자가 아니거나 쓸 수 없는 글자가 있으면 {@link InvalidRequestException}. */
    public static String normalize(String raw, int maxLength) {
        return normalize(raw, maxLength, FIELD);
    }

    /**
     * 위와 같고, 거부할 때 알리는 입력란을 정한다.
     *
     * @param field 요청 본문의 입력란(예: {@code displayName})
     */
    public static String normalize(String raw, int maxLength, String field) {
        return UserText.name(raw, maxLength, field);
    }
}
