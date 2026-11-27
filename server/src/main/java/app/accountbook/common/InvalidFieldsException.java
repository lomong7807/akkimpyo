package app.accountbook.common;

import java.util.List;

/** 여러 입력란의 규칙 오류를 한 번에 알린다(#29). API는 {@link #errors()}를 모두 답한다. 입력란, 코드, 문구는 첫 오류의 것이다. */
public class InvalidFieldsException extends InvalidRequestException {

    private final List<InvalidRequestException> errors;

    /** @param errors 하나 이상. 입력란의 순서대로 */
    public InvalidFieldsException(List<InvalidRequestException> errors) {
        super(errors.getFirst().field(), errors.getFirst().code(), errors.getFirst().getMessage());
        this.errors = List.copyOf(errors);
    }

    public List<InvalidRequestException> errors() {
        return errors;
    }
}
