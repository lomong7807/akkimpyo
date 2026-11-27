package app.accountbook.api;

import app.accountbook.api.Problem.InvalidField;
import app.accountbook.auth.InvalidCredentialsException;
import app.accountbook.common.DuplicateAccountNameException;
import app.accountbook.common.DuplicateCategoryNameException;
import app.accountbook.common.DuplicateEmailException;
import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidFieldsException;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.NotFoundException;
import app.accountbook.common.NotLedgerMemberException;
import app.accountbook.user.PasswordHashBusyException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.List;
import org.apache.catalina.connector.ClientAbortException;
import org.apache.coyote.BadRequestException;
import org.apache.tomcat.util.http.InvalidParameterException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.web.firewall.RequestRejectedException;
import org.springframework.web.ErrorResponse;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingPathVariableException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
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

    /** 비밀번호 해시의 자리를 다시 얻어 볼 시간(초). ADR 002 5절. */
    private static final String HASH_RETRY_AFTER = "1";

    @ExceptionHandler
    ResponseEntity<Problem> invalidBody(MethodArgumentNotValidException e, HttpServletRequest request) {
        return invalid(InvalidFields.of(e.getBindingResult()), e, request);
    }

    @ExceptionHandler
    ResponseEntity<Problem> invalidArgument(HandlerMethodValidationException e, HttpServletRequest request,
                                            HttpServletResponse response) throws Exception {
        if (e.isForReturnValue()) {
            return unexpected(e, request, response);
        }
        boolean inPath = e.getParameterValidationResults().stream()
                .anyMatch(result -> result.getMethodParameter().hasParameterAnnotation(PathVariable.class));
        return inPath ? respond(ErrorCode.NOT_FOUND, e, request)
                : invalid(InvalidFields.of(e.getParameterValidationResults()), e, request);
    }

    @ExceptionHandler
    ResponseEntity<Problem> missingQuery(MissingServletRequestParameterException e, HttpServletRequest request) {
        return invalid(e.getParameterName(), FieldErrorCode.REQUIRED, e, request);
    }

    /** 경로의 값이 형식에 맞지 않으면 없는 자원과 같다(ADR 002 4절). */
    @ExceptionHandler
    ResponseEntity<Problem> wrongType(MethodArgumentTypeMismatchException e, HttpServletRequest request) {
        return e.getParameter().hasParameterAnnotation(PathVariable.class)
                ? respond(ErrorCode.NOT_FOUND, e, request)
                : invalid(e.getName(), FieldErrorCode.INVALID_FORMAT, e, request);
    }

    @ExceptionHandler
    ResponseEntity<Problem> unreadableBody(HttpMessageNotReadableException e, HttpServletRequest request) {
        return InvalidFields.of(e)
                .map(field -> invalid(List.of(field), e, request))
                .orElseGet(() -> respond(ErrorCode.MALFORMED_REQUEST, e, request));
    }

    /** 쿼리나 본문의 인코딩이 깨졌거나, 쿼리의 이름에 쓸 수 없는 글자가 있다. 예외의 문구에 그 글자가 들어 있다. */
    @ExceptionHandler({BadRequestException.class, InvalidParameterException.class, RequestRejectedException.class})
    ResponseEntity<Problem> unreadableRequest(Exception e, HttpServletRequest request) {
        return respond(ErrorCode.MALFORMED_REQUEST, e, request);
    }

    /** 공백뿐인 경로의 값은 스프링이 없는 값으로 본다. */
    @ExceptionHandler({NotFoundException.class, NotLedgerMemberException.class, MissingPathVariableException.class})
    ResponseEntity<Problem> notFound(Exception e, HttpServletRequest request) {
        return respond(ErrorCode.NOT_FOUND, e, request);
    }

    @ExceptionHandler
    ResponseEntity<Problem> invalidRequest(InvalidRequestException e, HttpServletRequest request) {
        return invalid(e.field(), e.code(), e, request);
    }

    @ExceptionHandler
    ResponseEntity<Problem> invalidFields(InvalidFieldsException e, HttpServletRequest request) {
        List<InvalidField> fields = e.errors().stream()
                .map(error -> InvalidField.of(error.field(), error.code()))
                .toList();
        return invalid(fields, e, request);
    }

    @ExceptionHandler({DuplicateAccountNameException.class, DuplicateCategoryNameException.class})
    ResponseEntity<Problem> duplicateName(RuntimeException e, HttpServletRequest request) {
        return invalid("name", FieldErrorCode.DUPLICATE, e, request);
    }

    @ExceptionHandler
    ResponseEntity<Problem> duplicateEmail(DuplicateEmailException e, HttpServletRequest request) {
        return invalid("email", FieldErrorCode.DUPLICATE, e, request);
    }

    @ExceptionHandler
    ResponseEntity<Problem> invalidCredentials(InvalidCredentialsException e, HttpServletRequest request) {
        return respond(ErrorCode.INVALID_CREDENTIALS, HttpHeaders.WWW_AUTHENTICATE, SecurityConfig.CHALLENGE, e, request);
    }

    @ExceptionHandler
    ResponseEntity<Problem> hashBusy(PasswordHashBusyException e, HttpServletRequest request) {
        return respond(ErrorCode.TOO_MANY_REQUESTS, HttpHeaders.RETRY_AFTER, HASH_RETRY_AFTER, e, request);
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
            return respond(code, rejected.getHeaders(), List.of(), e, request);
        }
        log.error("처리하지 못한 예외", e);
        return body(ErrorCode.INTERNAL_ERROR, HttpHeaders.EMPTY, List.of(), request);
    }

    private static ResponseEntity<Problem> invalid(String field, FieldErrorCode code, Exception e,
                                                   HttpServletRequest request) {
        return invalid(List.of(InvalidField.of(field, code)), e, request);
    }

    private static ResponseEntity<Problem> invalid(List<InvalidField> fields, Exception e, HttpServletRequest request) {
        return respond(ErrorCode.VALIDATION_FAILED, HttpHeaders.EMPTY, fields, e, request);
    }

    private static ResponseEntity<Problem> respond(ErrorCode code, Exception e, HttpServletRequest request) {
        return respond(code, HttpHeaders.EMPTY, List.of(), e, request);
    }

    private static ResponseEntity<Problem> respond(ErrorCode code, String header, String value, Exception e,
                                                   HttpServletRequest request) {
        HttpHeaders headers = new HttpHeaders();
        headers.set(header, value);
        return respond(code, headers, List.of(), e, request);
    }

    private static ResponseEntity<Problem> respond(ErrorCode code, HttpHeaders headers, List<InvalidField> fields,
                                                   Exception e, HttpServletRequest request) {
        log.debug("{} {}", code, e.getClass().getSimpleName());
        return body(code, headers, fields, request);
    }

    /** Content-Type을 정해 두면 Accept와 무관하게 이 형식으로 나간다. */
    private static ResponseEntity<Problem> body(ErrorCode code, HttpHeaders headers, List<InvalidField> fields,
                                                HttpServletRequest request) {
        return ResponseEntity.status(code.status())
                .headers(headers)
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .body(Problem.of(code, RequestId.of(request), fields));
    }

    /** 클라이언트가 먼저 끊었는가. 다른 예외에 감싸여 올 수 있다. */
    static boolean isClientGone(Throwable e) {
        return e != null && (e instanceof ClientAbortException || isClientGone(e.getCause()));
    }
}
