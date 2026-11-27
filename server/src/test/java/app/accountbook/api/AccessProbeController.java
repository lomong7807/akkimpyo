package app.accountbook.api;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import org.springframework.boot.test.context.TestComponent;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 누구로 불렸는지 되돌려 주는 테스트용 컨트롤러. 운영 코드에는 컨트롤러가 아직 없다. */
@TestComponent
@RestController
@RequestMapping(AccessProbeController.PATH)
class AccessProbeController {

    static final String PATH = "/test/access";
    static final String ME = PATH + "/me";

    @GetMapping("/me")
    Caller me(@AuthenticationPrincipal UUID userId, HttpServletRequest request) {
        return Caller.of(userId, request);
    }

    /** 요청의 다른 곳에 적힌 사용자 id를 함께 받는다. 돌려주는 것은 토큰의 것이다. */
    @PostMapping("/users/{userId}")
    Caller other(@AuthenticationPrincipal UUID userId, @PathVariable("userId") UUID inPath,
                 @RequestParam("userId") UUID inQuery, @RequestHeader("X-User-Id") UUID inHeader,
                 @RequestBody Map<String, UUID> body, HttpServletRequest request) {
        return Caller.of(userId, request);
    }

    /** 세션을 만드는 나쁜 컨트롤러. 세션을 세는 방법이 헛돌지 않는지 본다. */
    @GetMapping("/session")
    Caller session(@AuthenticationPrincipal UUID userId, HttpServletRequest request) {
        request.getSession();
        return Caller.of(userId, request);
    }

    /** 쿼리의 이름을 모두 읽는다. */
    @GetMapping("/query")
    Map<String, String> query(@RequestParam Map<String, String> query) {
        return query;
    }

    /** 응답을 다른 스레드에서 만든다. */
    @GetMapping("/async")
    Callable<Caller> async(@AuthenticationPrincipal UUID userId, HttpServletRequest request) {
        Caller caller = Caller.of(userId, request);
        return () -> caller;
    }

    record Caller(UUID userId, String principalName, boolean session, boolean https) {

        static Caller of(UUID userId, HttpServletRequest request) {
            String name = request.getUserPrincipal() == null ? null : request.getUserPrincipal().getName();
            return new Caller(userId, name, request.getSession(false) != null, request.isSecure());
        }
    }
}
