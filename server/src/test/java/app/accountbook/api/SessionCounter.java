package app.accountbook.api;

import jakarta.servlet.http.HttpSessionEvent;
import jakarta.servlet.http.HttpSessionListener;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.boot.test.context.TestComponent;

/** 서버가 만든 세션의 수. */
@TestComponent
class SessionCounter implements HttpSessionListener {

    private final AtomicInteger created = new AtomicInteger();

    @Override
    public void sessionCreated(HttpSessionEvent event) {
        created.incrementAndGet();
    }

    int created() {
        return created.get();
    }
}
