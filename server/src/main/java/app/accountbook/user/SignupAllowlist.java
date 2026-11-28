package app.accountbook.user;

import app.accountbook.common.InvalidRequestException;
import java.util.HashSet;
import java.util.Set;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/**
 * 1단계 가입 허용 목록(P-102, F-003). 환경 변수 {@value #VARIABLE}에 쉼표로 나눈 항목을 받는다. 항목은 이메일 하나
 * ({@code owner@example.com})이거나 그 도메인 그대로만 받는(하위 도메인은 아니다) {@code @도메인}({@code @example.com})이다.
 * 항목과 가입하는 이메일을 모두 {@link EmailNormalizer}로 맞춰 비교한다.
 *
 * <p>제한을 끄는 설정은 없다. 변수가 없거나 비었으면 아무도 가입할 수 없다. 운영과 local에는 기본값이 없고 테스트용 도메인은
 * 테스트 설정에만 있다. 이메일도 도메인도 아닌 항목이 있으면 서버가 뜨지 않는다. 오류 문구에 항목의 값을 넣지 않는다.
 */
@Component
final class SignupAllowlist {

    static final String VARIABLE = "SIGNUP_ALLOWLIST";

    private final Set<String> emails = new HashSet<>();
    private final Set<String> domains = new HashSet<>();

    SignupAllowlist(Environment environment) {
        String value = environment.getProperty(VARIABLE, "");
        if (value.isBlank()) {
            return;
        }
        String[] entries = value.split(",", -1);
        for (int i = 0; i < entries.length; i++) {
            add(entries[i].trim(), i + 1);
        }
    }

    /** @param email {@link EmailNormalizer}로 맞춘 이메일 */
    boolean allows(String email) {
        return emails.contains(email) || domains.contains(domainOf(email));
    }

    private void add(String entry, int position) {
        try {
            if (entry.startsWith("@")) {
                // 앞에 글자 하나를 붙여 이메일과 같은 규칙(골뱅이 하나, 뒤가 비지 않음, ASCII)으로 본다.
                domains.add(domainOf(EmailNormalizer.normalize("x" + entry)));
            } else {
                emails.add(EmailNormalizer.normalize(entry));
            }
        } catch (InvalidRequestException e) {
            throw new IllegalStateException("환경 변수 " + VARIABLE + "의 " + position + "번째 항목이 이메일도 @도메인도 아니다. "
                    + "쉼표로 나눈 이메일(owner@example.com)이나 도메인(@example.com)을 넣는다.");
        }
    }

    private static String domainOf(String email) {
        return email.substring(email.indexOf('@') + 1);
    }
}
