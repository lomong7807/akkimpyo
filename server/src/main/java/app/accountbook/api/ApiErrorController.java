package app.accountbook.api;

import jakarta.servlet.DispatcherType;
import jakarta.servlet.RequestDispatcher;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.webmvc.error.ErrorController;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.web.header.HeaderWriter;
import org.springframework.security.web.header.writers.CacheControlHeadersWriter;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 상태로만 알려진 오류(필터의 예외, sendError, 본문을 다 받지 못함)의 응답. 스프링 부트의 기본 오류 응답을 대신한다. */
@RestController
class ApiErrorController implements ErrorController {

    private static final Logger log = LoggerFactory.getLogger(ApiErrorController.class);

    /** 필터 체인이 헤더를 쓰기 전에 끝난 요청(읽지 않은 경로, 바깥 필터의 예외, TRACE)도 캐시하지 않게 한다. 이미 있으면 쓰지 않는다. */
    private final HeaderWriter noCache = new CacheControlHeadersWriter();

    @RequestMapping("/error")
    ResponseEntity<Problem> error(HttpServletRequest request, HttpServletResponse response) {
        if (response.isCommitted()) {
            return null;
        }
        noCache.writeHeaders(request, response);
        int status = errorStatus(request);
        ErrorCode code = ErrorCode.of(status);
        if (code != ErrorCode.INTERNAL_ERROR) {
            log.debug("{} (상태 {})", code, status);
        } else if (status != code.status().value()) {
            // 본문을 다 받지 못한 것(408) 등. 500으로 온 것은 예외를 받은 쪽이 남겼다.
            log.warn("상태 {}을 500으로 답한다", status);
        }
        return ResponseEntity.status(code.status())
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .body(Problem.of(code, RequestId.of(request)));
    }

    /** 밖에서 이 경로를 직접 부르면 없는 경로다. */
    private static int errorStatus(HttpServletRequest request) {
        return request.getDispatcherType() == DispatcherType.ERROR
                && request.getAttribute(RequestDispatcher.ERROR_STATUS_CODE) instanceof Integer status
                ? status : HttpServletResponse.SC_NOT_FOUND;
    }
}
