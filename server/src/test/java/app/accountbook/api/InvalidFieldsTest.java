package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.api.Problem.InvalidField;
import app.accountbook.common.FieldErrorCode;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.validation.FieldError;
import org.springframework.validation.MapBindingResult;

/** HTTP로 만들기 어려운 입력 오류. 나머지는 ControllerErrorTest가 본다. */
class InvalidFieldsTest {

    private final MapBindingResult errors = new MapBindingResult(Map.of(), "command");

    @Test
    void 어느_입력란에도_붙지_않은_오류는_본문_전체의_오류다() {
        errors.reject("rule", "거절된 값 marker");

        assertThat(InvalidFields.of(errors)).containsExactly(InvalidField.of("", FieldErrorCode.NOT_ALLOWED));
    }

    @Test
    void 제약_애노테이션에서_나오지_않은_오류도_입력란을_알린다() {
        errors.rejectValue("amount", "rule", "거절된 값 marker");

        assertThat(InvalidFields.of(errors)).containsExactly(InvalidField.of("amount", FieldErrorCode.NOT_ALLOWED));
    }

    @Test
    void 객체로_묶은_쿼리의_형_오류는_INVALID_FORMAT이고_거절된_값을_옮기지_않는다() {
        errors.addError(new FieldError("command", "limit", "marker", true, null, null, "거절된 값 marker"));

        List<InvalidField> fields = InvalidFields.of(errors);

        assertThat(fields).containsExactly(InvalidField.of("limit", FieldErrorCode.INVALID_FORMAT));
        assertThat(fields.toString()).doesNotContain("marker");
    }

    @Test
    void 같은_입력란의_같은_오류는_한_번만_알린다() {
        errors.rejectValue("amount", "one", "");
        errors.rejectValue("amount", "two", "");

        assertThat(InvalidFields.of(errors)).hasSize(1);
    }
}
