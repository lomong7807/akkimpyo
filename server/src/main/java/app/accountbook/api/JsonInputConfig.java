package app.accountbook.api;

import org.springframework.boot.jackson.autoconfigure.JsonMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.MapperFeature;
import tools.jackson.databind.cfg.CoercionAction;
import tools.jackson.databind.cfg.CoercionInputShape;
import tools.jackson.databind.cfg.EnumFeature;
import tools.jackson.databind.type.LogicalType;

/**
 * 요청 JSON의 값을 다른 형으로 바꿔 받지 않는다(ADR 002 2절). 라이브러리의 기본값은 {@code 1.9}를 1로, {@code "5"}를 5로,
 * 수를 글자나 열거 값으로 받는다. 읽는 설정만 바꾸고 쓰는 JSON은 그대로다.
 */
@Configuration(proxyBeanMethods = false)
class JsonInputConfig {

    @Bean
    JsonMapperBuilderCustomizer rejectCoercion() {
        return builder -> builder
                // 글자로 온 수와 참거짓, 수로 온 참거짓과 날짜
                .disable(MapperFeature.ALLOW_COERCION_OF_SCALARS)
                // 공백뿐인 글자는 위의 설정만으로는 null이 된다
                .withCoercionConfigDefaults(config -> config.setAcceptBlankAsEmpty(false))
                .disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT)
                .enable(EnumFeature.FAIL_ON_NUMBERS_FOR_ENUMS)
                .withCoercionConfig(LogicalType.Textual, config -> config
                        .setCoercion(CoercionInputShape.Integer, CoercionAction.Fail)
                        .setCoercion(CoercionInputShape.Float, CoercionAction.Fail)
                        .setCoercion(CoercionInputShape.Boolean, CoercionAction.Fail));
    }
}
