package app.accountbook.api;

import app.accountbook.ledger.LedgerAccess;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.http.server.PathContainer;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.util.ServletRequestPathUtils;
import org.springframework.web.util.pattern.PathPattern;
import org.springframework.web.util.pattern.PathPatternParser;

/**
 * 장부 경로({@value #PATH})의 구성원 확인(ADR 002 5절, #13). 컨트롤러가 인자(본문, {@code @Valid})를 읽기 전에 돌아,
 * 구성원이 아닌 사람은 요청이 틀려도 404를 받는다. 본문 검증이 먼저면 400이 나가 장부가 있다는 것이 드러난다.
 * 형식이 틀린 장부 id도 없는 장부와 같은 404다. 서비스의 구성원 확인은 그대로 둔다. 보기 전용의 쓰기 거절(#11)도 이 자리다.
 *
 * <p>빈으로 두지 않는다. 빈이면 공개 메서드가 서비스 목록({@code ServiceMethodInventoryTest})에 든다.
 */
final class LedgerMemberInterceptor implements HandlerInterceptor {

    static final String PATH = "/api/v1/ledgers/{ledgerId}/**";

    /** 컨트롤러가 변수 이름을 어떻게 적든 요청 주소에서 바로 읽는다. */
    private static final PathPattern LEDGER_PATH = PathPatternParser.defaultInstance.parse(PATH);
    /** 36자 표준 표기만 받고 대소문자는 가리지 않는다(architect 결정 2026-11-26, #102). */
    private static final Pattern UUID_TEXT = Pattern.compile(
            "\\p{XDigit}{8}-\\p{XDigit}{4}-\\p{XDigit}{4}-\\p{XDigit}{4}-\\p{XDigit}{12}");

    private final LedgerAccess ledgerAccess;

    LedgerMemberInterceptor(LedgerAccess ledgerAccess) {
        this.ledgerAccess = ledgerAccess;
    }

    /** 본문은 {@link ApiErrorController}가 쓴다. 없는 경로와 같은 응답이다. */
    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
            throws IOException {
        if (ledgerId(request).filter(ledgerId -> ledgerAccess.isMember(actorId(), ledgerId)).isPresent()) {
            return true;
        }
        response.sendError(HttpServletResponse.SC_NOT_FOUND);
        return false;
    }

    private static Optional<UUID> ledgerId(HttpServletRequest request) {
        PathContainer path = ServletRequestPathUtils.getParsedRequestPath(request).pathWithinApplication();
        PathPattern.PathMatchInfo match = LEDGER_PATH.matchAndExtract(path);
        String ledgerId = match == null ? null : match.getUriVariables().get("ledgerId");
        return ledgerId != null && UUID_TEXT.matcher(ledgerId).matches()
                ? Optional.of(UUID.fromString(ledgerId)) : Optional.empty();
    }

    /** 장부 경로는 토큰이 있어야 열린다({@link SecurityConfig}). 다른 것이 오면 설정이 깨진 것이다. */
    private static UUID actorId() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null && authentication.getPrincipal() instanceof UUID actorId) {
            return actorId;
        }
        throw new IllegalStateException("장부 경로에 로그인하지 않은 요청이 왔다");
    }
}
