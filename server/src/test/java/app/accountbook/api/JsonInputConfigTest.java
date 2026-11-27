package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;

import app.accountbook.api.Problem.InvalidField;
import app.accountbook.common.FieldErrorCode;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.jackson.autoconfigure.JacksonAutoConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.mock.http.MockHttpInputMessage;
import tools.jackson.databind.json.JsonMapper;

/** 요청 JSON의 값을 다른 형으로 바꿔 받지 않는다(ADR 002 2절, #12). 스프링이 만드는 매퍼에 우리 설정이 걸린 것을 본다. */
class JsonInputConfigTest {

    private final JsonMapper strict = mapper(JsonInputConfig.class);

    @ParameterizedTest
    @CsvSource(delimiter = '|', quoteCharacter = '`', textBlock = """
            # 글자로 온 수
            amount    | {"amount":"5"}
            amount    | {"amount":""}
            amount    | {"amount":" "}
            count     | {"count":"5"}
            price     | {"price":"1.5"}
            # 소수로 온 정수. 값이 정수와 같아도 JSON 정수가 아니다
            amount    | {"amount":1.9}
            amount    | {"amount":1.0}
            amount    | {"amount":-0.5}
            amount    | {"amount":1e2}
            count     | {"count":1.9}
            # 수와 참거짓으로 온 글자
            text      | {"text":1}
            text      | {"text":1.5}
            text      | {"text":true}
            # 수로 온 열거 값과 날짜
            kind      | {"kind":0}
            kind      | {"kind":"0"}
            day       | {"day":20000}
            # 글자와 수로 온 참거짓
            flag      | {"flag":"true"}
            flag      | {"flag":1}
            # 목록 안
            lines[1].amount | {"lines":[{"amount":1},{"amount":"2"}]}
            lines[0].amount | {"lines":[{"amount":2.5}]}
            texts[0]  | {"texts":[1]}
            """)
    void 다른_형의_값은_그_입력란의_INVALID_FORMAT이다(String field, String json) {
        assertThat(InvalidFields.of(unreadable(strict, json)))
                .contains(InvalidField.of(field, FieldErrorCode.INVALID_FORMAT));
    }

    @ParameterizedTest
    @ValueSource(strings = {"{\"amount\":\"5\"}", "{\"amount\":1.9}", "{\"text\":1}", "{\"kind\":0}", "{\"kind\":\"0\"}"})
    void 설정이_없으면_조용히_바꿔_받는다(String json) {
        // 대조: 위의 거절이 라이브러리의 기본값이 아니라 우리 설정에서 나온다.
        assertThat(catchThrowable(() -> mapper().readValue(json, Input.class))).isNull();
    }

    @Test
    void 맞는_형의_값은_그대로_받는다() {
        Input input = strict.readValue("""
                {"amount":-9007199254740991,"count":0,"price":1,"text":"5","kind":"B","flag":true,"day":"2026-11-26",
                 "time":"09:05","id":"0b9f6c1e-3d52-4a7e-9c11-5f2e8a7d4b60","lines":[{"amount":1}],"texts":["","1.9"]}
                """, Input.class);

        assertThat(input).isEqualTo(new Input(-9007199254740991L, 0, BigDecimal.ONE, "5", Kind.B, true,
                LocalDate.of(2026, 11, 26), LocalTime.of(9, 5),
                UUID.fromString("0b9f6c1e-3d52-4a7e-9c11-5f2e8a7d4b60"), List.of(new Line(1L)), List.of("", "1.9")));
    }

    @Test
    void 값이_없거나_null인_것은_여기서_거절하지_않는다() {
        assertThat(strict.readValue("{\"amount\":null,\"text\":null,\"kind\":null}", Input.class))
                .isEqualTo(new Input(null, null, null, null, null, null, null, null, null, null, null));
    }

    @Test
    void 담기지_않는_정수는_그대로_OUT_OF_RANGE다() {
        assertThat(InvalidFields.of(unreadable(strict, "{\"amount\":99999999999999999999}")))
                .contains(InvalidField.of("amount", FieldErrorCode.OUT_OF_RANGE));
    }

    @Test
    void 쓰는_JSON은_달라지지_않는다() {
        Output output = new Output(1L, 2, new BigDecimal("1.50"), 0.1, "글자", Kind.A, true, LocalDate.of(2026, 11, 26),
                LocalTime.of(9, 5), Instant.parse("2026-11-26T00:00:00.123456Z"), new UUID(1, 2), null,
                List.of(new Line(3L)));

        assertThat(strict.writeValueAsString(output)).isEqualTo(mapper().writeValueAsString(output));
    }

    private static HttpMessageNotReadableException unreadable(JsonMapper mapper, String json) {
        Throwable cause = catchThrowable(() -> mapper.readValue(json, Input.class));
        assertThat(cause).as(json).isNotNull();
        return new HttpMessageNotReadableException("읽을 수 없다", cause, new MockHttpInputMessage(new byte[0]));
    }

    private static JsonMapper mapper(Class<?>... configurations) {
        JsonMapper[] made = new JsonMapper[1];
        new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(JacksonAutoConfiguration.class))
                .withUserConfiguration(configurations)
                .run(context -> made[0] = context.getBean(JsonMapper.class));
        return made[0];
    }

    private enum Kind { A, B }

    private record Line(Long amount) {
    }

    private record Input(Long amount, Integer count, BigDecimal price, String text, Kind kind, Boolean flag,
                         LocalDate day, LocalTime time, UUID id, List<Line> lines, List<String> texts) {
    }

    private record Output(long amount, int count, BigDecimal price, double ratio, String text, Kind kind, boolean flag,
                          LocalDate day, LocalTime time, Instant at, UUID id, String nothing, List<Line> lines) {
    }
}
