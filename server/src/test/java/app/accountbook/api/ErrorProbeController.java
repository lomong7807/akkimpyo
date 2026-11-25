package app.accountbook.api;

import com.fasterxml.jackson.annotation.JsonFormat;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.boot.test.context.TestComponent;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 공통 오류 처리를 부르기 위한 테스트용 컨트롤러. 운영 코드에는 컨트롤러가 아직 없다. */
@TestComponent
@RestController
@RequestMapping(ErrorProbeController.PATH)
class ErrorProbeController {

    static final String PATH = "/test/errors";

    private final JdbcTemplate jdbc;
    private volatile Throwable toThrow;

    ErrorProbeController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** 다음 {@code GET /throw}가 던질 것. */
    void willThrow(Throwable throwable) {
        this.toThrow = throwable;
    }

    @GetMapping("/throw")
    void throwPrepared() throws Throwable {
        throw toThrow;
    }

    @GetMapping("/ok")
    Saved ok() {
        return new Saved("ok");
    }

    @PostMapping("/body")
    Saved body(@Valid @RequestBody Command command) {
        return new Saved(command.name());
    }

    /** 입력값을 예외 문구에 담는 나쁜 서비스. 응답에 나가지 않아야 한다. */
    @PostMapping("/fail-with-value")
    Saved failWithValue(@RequestBody Command command) {
        throw new IllegalStateException("저장할 수 없는 값: " + command);
    }

    @GetMapping("/query")
    Saved query(@RequestParam int version, @RequestParam(name = "limit", defaultValue = "50") @Max(100) int size,
                @RequestParam(required = false) UUID cursor) {
        return new Saved(version + " " + size + " " + cursor);
    }

    @PostMapping("/query-and-body")
    Saved queryAndBody(@RequestParam @Max(100) int limit, @Valid @RequestBody Command command) {
        return new Saved(limit + command.name());
    }

    @GetMapping("/ledgers/{ledgerId}")
    Saved ledger(@PathVariable UUID ledgerId) {
        return new Saved(ledgerId.toString());
    }

    @GetMapping("/codes/{code}")
    Saved code(@PathVariable @Size(max = 5) String code) {
        return new Saved(code);
    }

    /** 변환되지 않은 제약 위반. 저장되는 것은 없다. */
    @PostMapping("/db-violation")
    Saved dbViolation(@RequestBody Command command) {
        jdbc.update("""
                insert into users (id, email, password_hash, display_name, created_at)
                values (gen_random_uuid(), ?, ?, '이름', now())
                """, command.email(), command.name());
        return new Saved("저장됨");
    }

    /** 응답을 내보내기 시작한 뒤에 실패한다. */
    @GetMapping("/fail-after-flush")
    void failAfterFlush(HttpServletResponse response) throws IOException {
        response.setContentType(MediaType.TEXT_PLAIN_VALUE);
        response.getOutputStream().write("partial".getBytes(StandardCharsets.UTF_8));
        response.flushBuffer();
        throw new IllegalStateException("보낸 뒤의 실패");
    }

    record Saved(String value) {
    }

    record Command(
            @NotBlank @Size(max = 5) String name,
            @NotNull @Min(1) @Max(100) Long amount,
            @Email String email,
            @Pattern(regexp = "[a-z]*") @Size(min = 2, max = 5) String code,
            @JsonFormat(shape = JsonFormat.Shape.STRING) LocalDate occurredOn,
            Kind kind,
            @Size(min = 1) List<@Valid Line> lines) {

        /** 값 하나가 아니라 조합의 규칙. 입력란 이름은 allowed가 된다. */
        @AssertTrue
        boolean isAllowed() {
            return !"zz".equals(code);
        }
    }

    enum Kind { A, B }

    record Line(@Min(1) long amount) {
    }
}
