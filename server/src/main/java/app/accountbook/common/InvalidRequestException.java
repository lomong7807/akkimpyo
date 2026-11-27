package app.accountbook.common;

import java.util.List;
import java.util.stream.Collectors;

/**
 * 요청 값이 규칙에 맞지 않는다. 아무것도 저장하지 않는다.
 * API는 {@link #errors()}의 {@link #field()}와 {@link #code()}로 답하고(ADR 002의 {@code VALIDATION_FAILED}) 문구는 응답에 싣지 않는다.
 * 여러 입력란이 함께 틀렸으면 {@link #ofAll}로 한 번에 알린다(#13).
 */
public class InvalidRequestException extends RuntimeException {

    /** 어느 입력란인지 정하지 않았거나 요청 본문 전체의 오류다. */
    private static final String WHOLE_BODY = "";

    private final String field;
    private final FieldErrorCode code;
    /** 여럿을 함께 알릴 때 하나하나. 하나만 알리면 비어 있다. */
    private final List<InvalidRequestException> errors;

    /** 어느 입력란인지 아직 정하지 않은 곳이 쓴다. 새 코드는 입력란을 담는 생성자를 쓴다. */
    public InvalidRequestException(String message) {
        this(WHOLE_BODY, FieldErrorCode.NOT_ALLOWED, message);
    }

    /** @param field 입력란. 요청 본문의 경로(예: {@code amount}, {@code lines[0].amount})다 */
    public InvalidRequestException(String field, FieldErrorCode code, String message) {
        super(message);
        this.field = field;
        this.code = code;
        this.errors = List.of();
    }

    private InvalidRequestException(List<InvalidRequestException> errors) {
        super(errors.stream().map(Throwable::getMessage).collect(Collectors.joining(" ")));
        this.field = errors.getFirst().field;
        this.code = errors.getFirst().code;
        this.errors = List.copyOf(errors);
    }

    /** 입력란 오류 여럿(1개 이상)을 한 번에 알린다. 하나면 그것을 그대로 돌려준다. */
    public static InvalidRequestException ofAll(List<InvalidRequestException> errors) {
        return errors.size() == 1 ? errors.getFirst()
                : new InvalidRequestException(errors.stream().flatMap(error -> error.errors().stream()).toList());
    }

    /** 알리는 입력란 오류 하나하나. 하나만 알리면 자신뿐이다. */
    public List<InvalidRequestException> errors() {
        return errors.isEmpty() ? List.of(this) : errors;
    }

    /** 여럿을 함께 알리면 첫 번째 것의 입력란이다. */
    public String field() {
        return field;
    }

    public FieldErrorCode code() {
        return code;
    }
}
