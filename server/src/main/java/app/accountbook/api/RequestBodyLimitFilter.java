package app.accountbook.api;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Objects;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * 본문을 다 받아 상한({@link RequestBodyProperties}) 안이면 안쪽으로 넘기고, 넘으면 413으로 끝낸다(ADR 002 5절, #21).
 *
 * <p>안쪽이 읽을 때 세지 않고 먼저 다 받는 이유: 길이를 미리 알 수 없는 조각 전송도 토큰 조회와 비밀번호 해시보다 먼저 거절해야 하고,
 * 컨트롤러가 읽다가 넘으면 413이 아니라 읽을 수 없는 본문(400)이 되기 때문이다.
 */
@Order(RequestBodyLimitFilter.ORDER)
final class RequestBodyLimitFilter extends OncePerRequestFilter {

    /** 요청 id({@link RequestBoundaryFilter})와 스프링 부트의 측정 필터(+1) 바로 안쪽. 로그인 확인을 비롯한 나머지보다 앞이다. */
    static final int ORDER = Ordered.HIGHEST_PRECEDENCE + 2;

    private final int maxSize;

    RequestBodyLimitFilter(RequestBodyProperties properties) {
        this.maxSize = Math.toIntExact(properties.maxSize().toBytes());
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (request.getContentLengthLong() > maxSize) {
            reject(response);
            return;
        }
        byte[] body;
        try {
            body = request.getInputStream().readNBytes(maxSize + 1);
        } catch (IOException e) {
            if (response.isCommitted()) {
                // Tomcat이 상태를 정했다(보내다 멈췄으면 408). 던지면 400으로 바뀌어 화면이 다시 보내지 않는다.
                return;
            }
            throw e;
        }
        if (body.length > maxSize) {
            reject(response);
            return;
        }
        chain.doFilter(new ReceivedRequest(request, body), response);
    }

    /** 본문은 {@link ApiErrorController}가 쓴다. 남은 본문은 Tomcat이 2MB까지만 읽어 버리고 연결을 닫는다. */
    private static void reject(HttpServletResponse response) throws IOException {
        response.sendError(ErrorCode.PAYLOAD_TOO_LARGE.status().value());
    }

    /** 본문을 이미 다 받은 요청. */
    private static final class ReceivedRequest extends HttpServletRequestWrapper {

        private final ServletInputStream body;

        private ReceivedRequest(HttpServletRequest request, byte[] body) {
            super(request);
            this.body = new ReceivedBody(body);
        }

        @Override
        public ServletInputStream getInputStream() {
            return body;
        }

        @Override
        public BufferedReader getReader() throws IOException {
            String encoding = Objects.requireNonNullElse(getCharacterEncoding(), StandardCharsets.ISO_8859_1.name());
            return new BufferedReader(new InputStreamReader(body, encoding));
        }
    }

    private static final class ReceivedBody extends ServletInputStream {

        private final ByteArrayInputStream bytes;

        private ReceivedBody(byte[] bytes) {
            this.bytes = new ByteArrayInputStream(bytes);
        }

        @Override
        public int read() {
            return bytes.read();
        }

        @Override
        public int read(byte[] buffer, int offset, int length) {
            return bytes.read(buffer, offset, length);
        }

        @Override
        public boolean isFinished() {
            return bytes.available() == 0;
        }

        @Override
        public boolean isReady() {
            return true;
        }

        @Override
        public void setReadListener(ReadListener listener) {
            throw new IllegalStateException("이미 다 받은 본문은 나눠 읽지 않는다");
        }
    }
}
