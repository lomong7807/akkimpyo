package app.accountbook.transaction;

import app.accountbook.common.UserText;
import jakarta.persistence.Query;

/**
 * 같은 가맹점인지 DB에서 보는 조건(P-218 중복 경고, #59. 카테고리 제안 #61과 같은 규칙). 요청 값은 저장할 때처럼 맞춘 것
 * ({@link UserText#payee})이다. 저장된 값과 요청 값 양쪽에서 공백류를 모두 빼고, 대소문자는 양쪽 모두 DB의 {@code lower}로
 * 바꾼다(한쪽만 Java로 바꾸면 DB 로캘에 따라 어긋날 수 있다). JPQL과 SQL에 같은 글자로 쓴다.
 */
final class PayeeMatch {

    private PayeeMatch() {
    }

    /** {@code column}이 {@code :payee}와 같은 가맹점이라는 조건. 값은 {@link #bind}로 넣는다. */
    static String sameAs(String column) {
        return "lower(translate(" + column + ", :spaces, '')) = lower(translate(:payee, :spaces, ''))";
    }

    /** @param payee {@link UserText#payee}로 맞춘 요청 값 */
    static void bind(Query query, String payee) {
        query.setParameter("spaces", UserText.TRIMMED_SPACES).setParameter("payee", payee);
    }
}
