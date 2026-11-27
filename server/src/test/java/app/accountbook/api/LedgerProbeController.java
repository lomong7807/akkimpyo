package app.accountbook.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.boot.test.context.TestComponent;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** 장부 경로에서 본문을 읽고 {@code @Valid}로 검증하는 테스트용 컨트롤러. 구성원 확인이 그보다 먼저인지 본다. */
@TestComponent
@RestController
class LedgerProbeController {

    static final String PATH = "/api/v1/ledgers/{ledgerId}/test-probe";

    final AtomicInteger calls = new AtomicInteger();

    @PostMapping(path = PATH, consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    Map<String, String> probe(@PathVariable UUID ledgerId, @Valid @RequestBody Body body) {
        calls.incrementAndGet();
        return Map.of("value", body.value());
    }

    record Body(@NotNull String value) {
    }
}
