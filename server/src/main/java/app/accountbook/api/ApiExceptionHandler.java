package app.accountbook.api;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.apache.catalina.connector.ClientAbortException;
import org.apache.coyote.BadRequestException;
import org.apache.tomcat.util.http.InvalidParameterException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.ErrorResponse;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

/**
 * 모든 예외를 ADR 002의 오류 응답 하나로 바꾼다. 프레임워크의 기본 오류 응답은 내보내지 않는다(요청 값이 들어 있다).
 * 예외를 다음 처리기로 넘기면 스프링이 거절된 값을 WARN 로그에 남기므로 여기서 끝낸다.
 *
 * <p>요청의 잘못(4xx)은 DEBUG에 code와 예외의 종류만 남긴다. 예외의 문구에는 요청 값이 들어 있을 수 있어 남기지 않는다.
 * 500은 ERROR로 한 번 남긴다.
 */
@RestControllerAdvice
class ApiExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    /** 본문, 쿼리, 경로의 값을 읽을 수 없다. 뒤의 둘은 Tomcat이 알린 깨진 인코딩이다. */
    @ExceptionHandler({HttpMessageNotReadableException.class, MethodArgumentTypeMismatchException.class,
            BadRequestException.class, InvalidParameterException.class})
    ResponseEntity<Problem> unreadable(Exception e, HttpServletRequest request) {
        return respond(ErrorCode.MALFORMED_REQUEST, HttpHeaders.EMPTY, e, request);
    }

    /** 위에 없는 모든 것. 프레임워크가 요청의 잘못이라고 한 것 말고는 500이다. */
    @ExceptionHandler(Exception.class)
    ResponseEntity<Problem> unexpected(Exception e, HttpServletRequest request, HttpServletResponse response)
            throws Exception {
        if (isClientGone(e)) {
            return null;
        }
        if (response.isCommitted()) {
            // 이미 보낸 응답에 오류를 덧붙이지 않는다. 바깥 필터가 남기고 연결을 끊는다.
            throw e;
        }
        if (e instanceof ErrorResponse rejected && rejected.getStatusCode().is4xxClientError()) {
            ErrorCode code = ErrorCode.of(rejected.getStatusCode().value());
            return respond(code, rejected.getHeaders(), e, request);
        }
        log.error("처리하지 못한 예외", e);
        return body(ErrorCode.INTERNAL_ERROR, HttpHeaders.EMPTY, request);
    }

    private static ResponseEntity<Problem> respond(ErrorCode code, HttpHeaders headers, Exception e,
                                                   HttpServletRequest request) {
        log.debug("{} {}", code, e.getClass().getSimpleName());
        return body(code, headers, request);
    }

    /** Content-Type을 정해 두면 Accept와 무관하게 이 형식으로 나간다. */
    private static ResponseEntity<Problem> body(ErrorCode code, HttpHeaders headers, HttpServletRequest request) {
        return ResponseEntity.status(code.status())
                .headers(headers)
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .body(Problem.of(code, RequestId.of(request)));
    }

    private static boolean isClientGone(Throwable e) {
        return e != null && (e instanceof ClientAbortException || isClientGone(e.getCause()));
    }
}
