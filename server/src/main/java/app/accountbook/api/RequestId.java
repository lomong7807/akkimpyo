package app.accountbook.api;

import jakarta.servlet.http.HttpServletRequest;
import java.util.UUID;
import java.util.regex.Pattern;

/** 요청 하나를 가리키는 값(ADR 002 4절, ADR 005 결정 7). 응답 헤더, 오류 본문, 로그에 같은 값이 들어간다. */
final class RequestId {

    static final String HEADER = "X-Request-Id";

    /** 로그와 헤더에 그대로 들어가므로 이 글자 밖의 값은 받지 않는다. */
    private static final Pattern FORMAT = Pattern.compile("[A-Za-z0-9_-]{1,64}");
    private static final String ATTRIBUTE = RequestId.class.getName();

    private RequestId() {
    }

    /** 이 요청의 id. 처음 부를 때 프록시가 준 값으로 정하고, 없거나 형식이 아니면 새로 만든다. */
    static String of(HttpServletRequest request) {
        if (request.getAttribute(ATTRIBUTE) instanceof String id) {
            return id;
        }
        String given = request.getHeader(HEADER);
        String id = given != null && FORMAT.matcher(given).matches() ? given : UUID.randomUUID().toString();
        request.setAttribute(ATTRIBUTE, id);
        return id;
    }
}
