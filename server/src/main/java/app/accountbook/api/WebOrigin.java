package app.accountbook.api;

import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/**
 * 우리 웹의 출처(ADR 001 결정 5). 환경 변수로 받고 운영에는 기본값이 없다(local 프로파일만 웹 개발 서버의 출처를 둔다).
 * 없거나 브라우저가 {@code Origin}으로 보내는 모양이 아니면 서버가 뜨지 않는다. 글자 그대로 비교하므로 모양이 다르면 모든
 * 요청이 거절되기 때문이다.
 */
@Component
final class WebOrigin {

    static final String VARIABLE = "WEB_ORIGIN";

    private static final String LABEL = "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?";
    private static final String PORT = "(?::([1-9][0-9]{0,4}))?";
    private static final Pattern HTTPS = Pattern.compile("https://" + LABEL + "(?:\\." + LABEL + ")*" + PORT);
    /** 평문은 로컬 개발의 화면 서버뿐이다. */
    private static final Pattern LOCAL = Pattern.compile("http://localhost" + PORT);
    private static final int MAX_PORT = 65_535;

    private final String value;

    WebOrigin(Environment environment) {
        this.value = environment.getProperty(VARIABLE);
        if (value == null || !(isOrigin(HTTPS.matcher(value), 443) || isOrigin(LOCAL.matcher(value), 80))) {
            throw new IllegalStateException("환경 변수 " + VARIABLE + "에 웹의 출처를 넣어야 한다. 경로와 기본 포트 없이 소문자로 적은 "
                    + "https://이름[:포트]이고, 로컬 개발은 http://localhost[:포트]도 된다. 예: https://example.com");
        }
    }

    /** {@code Origin} 헤더의 값이 우리 출처와 글자 그대로 같은가. */
    boolean matches(String origin) {
        return value.equals(origin);
    }

    /** 브라우저는 기본 포트를 적지 않는다. */
    private static boolean isOrigin(Matcher matcher, int defaultPort) {
        if (!matcher.matches()) {
            return false;
        }
        if (matcher.group(1) == null) {
            return true;
        }
        int port = Integer.parseInt(matcher.group(1));
        return port <= MAX_PORT && port != defaultPort;
    }
}
