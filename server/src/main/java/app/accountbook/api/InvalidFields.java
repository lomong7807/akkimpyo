package app.accountbook.api;

import app.accountbook.api.Problem.InvalidField;
import app.accountbook.common.FieldErrorCode;
import jakarta.validation.ConstraintViolation;
import java.lang.reflect.Array;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Stream;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.Errors;
import org.springframework.validation.FieldError;
import org.springframework.validation.ObjectError;
import org.springframework.validation.method.ParameterErrors;
import org.springframework.validation.method.ParameterValidationResult;
import org.springframework.web.bind.annotation.RequestParam;
import tools.jackson.core.JacksonException;
import tools.jackson.core.JsonParser;
import tools.jackson.core.TokenStreamContext;
import tools.jackson.core.exc.InputCoercionException;
import tools.jackson.databind.DatabindException;

/**
 * 프레임워크가 알린 입력 오류를 입력란 오류(ADR 002 4절 {@code fieldErrors})로 바꾼다. 거절된 값과 문구는 옮기지 않는다.
 *
 * <p>{@code field}는 요청 DTO의 속성 이름과 컨트롤러에 적은 쿼리 이름이다. 다음 셋에서는 요청의 글자가 {@code field}로
 * 나갈 수 있다: 요청 DTO의 {@code Map}, 모르는 속성을 거부하는 설정({@code FAIL_ON_UNKNOWN_PROPERTIES}),
 * 쿼리를 객체로 묶는 {@code @ModelAttribute}의 {@code Map}이나 목록. 지금은 셋 다 쓰지 않는다.
 */
final class InvalidFields {

    /** 요청 본문 전체의 오류를 가리키는 입력란. */
    private static final String WHOLE_BODY = "";

    private InvalidFields() {
    }

    static List<InvalidField> of(Errors errors) {
        return errors.getAllErrors().stream()
                .map(InvalidFields::ofError)
                .distinct()
                .toList();
    }

    /** 컨트롤러 인자에 바로 붙은 제약(쿼리 값)과 목록 본문의 검증 실패. */
    static List<InvalidField> of(List<ParameterValidationResult> results) {
        return results.stream()
                .flatMap(result -> result instanceof ParameterErrors errors
                        ? of((Errors) errors).stream() : ofParameter(result))
                .distinct()
                .toList();
    }

    /** JSON은 읽혔지만 값의 형이 틀렸으면 그 입력란. JSON 하나로 읽을 수 없으면 비어 있다. */
    static Optional<InvalidField> of(HttpMessageNotReadableException e) {
        return switch (e.getCause()) {
            case InputCoercionException tooBig ->
                    Optional.of(InvalidField.of(path(tooBig), FieldErrorCode.OUT_OF_RANGE));
            case DatabindException wrongType when !isAfterBody(wrongType) ->
                    Optional.of(InvalidField.of(path(wrongType), FieldErrorCode.INVALID_FORMAT));
            case null, default -> Optional.empty();
        };
    }

    /** 본문의 JSON 하나를 다 읽은 뒤에 값이 더 있다({@code {} {}}). 최상위에서 몇 번째 값을 읽던 중인지로 안다. */
    private static boolean isAfterBody(DatabindException e) {
        if (!(e.processor() instanceof JsonParser parser)) {
            return false;
        }
        TokenStreamContext context = parser.streamReadContext();
        while (!context.inRoot()) {
            context = context.getParent();
        }
        return context.getCurrentIndex() > 0;
    }

    private static InvalidField ofError(ObjectError error) {
        return error instanceof FieldError field
                ? InvalidField.of(field.getField(),
                        field.isBindingFailure() ? FieldErrorCode.INVALID_FORMAT : constraintCode(field))
                : InvalidField.of(WHOLE_BODY, constraintCode(error));
    }

    /** 제약 애노테이션에서 나온 오류가 아니면 규칙에 맞지 않는 값으로 본다. */
    private static FieldErrorCode constraintCode(ObjectError error) {
        return error.contains(ConstraintViolation.class)
                ? code(error.unwrap(ConstraintViolation.class)) : FieldErrorCode.NOT_ALLOWED;
    }

    private static Stream<InvalidField> ofParameter(ParameterValidationResult result) {
        RequestParam query = result.getMethodParameter().getParameterAnnotation(RequestParam.class);
        String name = query != null && !query.name().isEmpty()
                ? query.name() : result.getMethodParameter().getParameterName();
        return result.getResolvableErrors().stream()
                .map(error -> InvalidField.of(name, code(result.unwrap(error, ConstraintViolation.class))));
    }

    /** {@code lines[0].amount} 모양의 경로. */
    private static String path(JacksonException e) {
        StringBuilder path = new StringBuilder();
        for (JacksonException.Reference reference : e.getPath()) {
            if (reference.getPropertyName() == null) {
                path.append('[').append(reference.getIndex()).append(']');
            } else {
                path.append(path.isEmpty() ? "" : ".").append(reference.getPropertyName());
            }
        }
        return path.toString();
    }

    private static FieldErrorCode code(ConstraintViolation<?> violation) {
        String constraint = violation.getConstraintDescriptor().getAnnotation().annotationType().getSimpleName();
        return switch (constraint) {
            case "NotNull", "NotBlank", "NotEmpty" -> FieldErrorCode.REQUIRED;
            case "Size" -> sizeCode(violation);
            case "Min", "Max", "DecimalMin", "DecimalMax", "Positive", "PositiveOrZero", "Negative", "NegativeOrZero",
                 "Past", "PastOrPresent", "Future", "FutureOrPresent" -> FieldErrorCode.OUT_OF_RANGE;
            case "Pattern", "Email", "Digits" -> FieldErrorCode.INVALID_FORMAT;
            default -> FieldErrorCode.NOT_ALLOWED;
        };
    }

    private static FieldErrorCode sizeCode(ConstraintViolation<?> violation) {
        int size = size(violation.getInvalidValue());
        int max = (int) violation.getConstraintDescriptor().getAttributes().get("max");
        if (size > max) {
            return FieldErrorCode.TOO_LONG;
        }
        return size == 0 ? FieldErrorCode.REQUIRED : FieldErrorCode.INVALID_FORMAT;
    }

    private static int size(Object value) {
        return switch (value) {
            case CharSequence text -> text.length();
            case Collection<?> items -> items.size();
            case Map<?, ?> entries -> entries.size();
            default -> Array.getLength(value);
        };
    }
}
