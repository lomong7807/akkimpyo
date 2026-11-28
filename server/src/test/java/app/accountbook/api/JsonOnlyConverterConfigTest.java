package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.converter.ByteArrayHttpMessageConverter;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.converter.HttpMessageConverters;
import org.springframework.http.converter.json.JacksonJsonHttpMessageConverter;

/**
 * 변환기는 JSON 계열과 바이트만 남는다(ADR 003 결정 9). 테스트의 실행 경로에는 springdoc이 들여온 YAML과 JAXB(XML)가 있어
 * 기본 목록에 그 변환기가 생긴다. HTTP로 본 415와 400은 {@link JsonOnlyConverterTest}가 본다.
 */
class JsonOnlyConverterConfigTest {

    @Test
    void 기본_목록에서_JSON_계열과_바이트만_남는다() {
        HttpMessageConverters.ServerBuilder builder = HttpMessageConverters.forServer().registerDefaults();
        new JsonOnlyConverterConfig().configureMessageConverters(builder);

        List<Class<?>> kept = new ArrayList<>();
        builder.build().forEach(converter -> kept.add(converter.getClass()));

        assertThat(kept).containsExactlyInAnyOrder(ByteArrayHttpMessageConverter.class,
                JacksonJsonHttpMessageConverter.class);
    }

    @Test
    void 빼기_전의_기본_목록에는_YAML과_XML과_글자_변환기가_있다() {
        List<String> names = new ArrayList<>();
        for (HttpMessageConverter<?> converter : HttpMessageConverters.forServer().registerDefaults().build()) {
            names.add(converter.getClass().getSimpleName());
        }

        assertThat(names).contains("JacksonYamlHttpMessageConverter", "Jaxb2RootElementHttpMessageConverter",
                "StringHttpMessageConverter");
    }
}
