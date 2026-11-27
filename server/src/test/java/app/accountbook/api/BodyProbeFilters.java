package app.accountbook.api;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.boot.servlet.filter.OrderedFilter;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.web.filter.OncePerRequestFilter;

/** 본문 상한 필터의 바깥에서 읽힌 양을 세고, 안쪽(로그인 확인의 자리)에 닿았는지 본다. 요청은 {@code X-Request-Id}로 가린다. */
@TestConfiguration(proxyBeanMethods = false)
class BodyProbeFilters {

    @Bean
    ReadBytes readBytes() {
        return new ReadBytes();
    }

    @Bean
    Inside inside() {
        return new Inside();
    }

    /** 이 서버가 요청의 본문을 몇 바이트 읽었는가. */
    @Order(Ordered.HIGHEST_PRECEDENCE + 1)
    static class ReadBytes extends OncePerRequestFilter {

        private final Map<String, AtomicLong> counts = new ConcurrentHashMap<>();

        long of(String requestId) {
            return counts.get(requestId).get();
        }

        @Override
        protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
                throws ServletException, IOException {
            AtomicLong count = counts.computeIfAbsent(RequestId.of(request), id -> new AtomicLong());
            chain.doFilter(new HttpServletRequestWrapper(request) {
                @Override
                public ServletInputStream getInputStream() throws IOException {
                    return new Counting(super.getInputStream(), count);
                }
            }, response);
        }
    }

    /** 스프링 부트가 Spring Security의 필터를 두는 자리(#188). 토큰 조회와 비밀번호 확인은 이 안쪽이다. */
    @Order(OrderedFilter.REQUEST_WRAPPER_FILTER_MAX_ORDER - 100)
    static class Inside extends OncePerRequestFilter {

        private final Map<String, Boolean> reached = new ConcurrentHashMap<>();

        boolean reached(String requestId) {
            return reached.containsKey(requestId);
        }

        @Override
        protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
                throws ServletException, IOException {
            reached.put(RequestId.of(request), true);
            chain.doFilter(request, response);
        }
    }

    private static final class Counting extends ServletInputStream {

        private final ServletInputStream in;
        private final AtomicLong count;

        private Counting(ServletInputStream in, AtomicLong count) {
            this.in = in;
            this.count = count;
        }

        @Override
        public int read() throws IOException {
            int value = in.read();
            if (value >= 0) {
                count.incrementAndGet();
            }
            return value;
        }

        @Override
        public int read(byte[] bytes, int offset, int length) throws IOException {
            int n = in.read(bytes, offset, length);
            if (n > 0) {
                count.addAndGet(n);
            }
            return n;
        }

        @Override
        public boolean isFinished() {
            return in.isFinished();
        }

        @Override
        public boolean isReady() {
            return in.isReady();
        }

        @Override
        public void setReadListener(ReadListener listener) {
            in.setReadListener(listener);
        }
    }
}
