package app.accountbook.api;

import java.io.IOException;
import java.util.concurrent.atomic.AtomicBoolean;
import org.apache.catalina.connector.Request;
import org.apache.catalina.connector.Response;
import org.apache.catalina.valves.ErrorReportValve;
import org.apache.coyote.ActionCode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import tools.jackson.databind.json.JsonMapper;

/**
 * Tomcat이 애플리케이션에 넘기지 않고 거절한 요청(읽을 수 없는 요청 줄, 깨진 경로 등)의 응답.
 * 필터를 거치지 않았으므로 요청 id도 여기서 넣는다. Tomcat의 HTML 오류 페이지를 대신한다.
 */
final class ProblemErrorReportValve extends ErrorReportValve {

    private static final Logger log = LoggerFactory.getLogger(ProblemErrorReportValve.class);

    private final JsonMapper jsonMapper;

    ProblemErrorReportValve(JsonMapper jsonMapper) {
        this.jsonMapper = jsonMapper;
    }

    @Override
    protected void report(Request request, Response response, Throwable throwable) {
        int status = response.getStatus();
        if (status < 400 || response.getContentWritten() > 0 || !response.setErrorReported() || !canWrite(response)) {
            return;
        }
        ErrorCode code = ErrorCode.of(status);
        String requestId = RequestId.of(request);
        log(code, status, requestId);
        byte[] body = jsonMapper.writeValueAsBytes(Problem.of(code, requestId));
        response.setStatus(code.status().value());
        response.setHeader(RequestId.HEADER, requestId);
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        response.setContentLength(body.length);
        try {
            response.getOutputStream().write(body);
            response.finishResponse();
        } catch (IOException e) {
            log.debug("오류 응답을 보내지 못했다 requestId={}", requestId);
        }
    }

    /** 필터 밖이라 MDC가 없으므로 요청 id를 문구에 적는다. 예외가 있으면 Tomcat이 남겼다. */
    private static void log(ErrorCode code, int status, String requestId) {
        if (code == ErrorCode.INTERNAL_ERROR) {
            log.error("Tomcat 단계의 오류 (상태 {}) requestId={}", status, requestId);
        } else {
            log.debug("{} (상태 {}) requestId={}", code, status, requestId);
        }
    }

    private static boolean canWrite(Response response) {
        AtomicBoolean allowed = new AtomicBoolean();
        response.getCoyoteResponse().action(ActionCode.IS_IO_ALLOWED, allowed);
        return allowed.get();
    }
}
