package app.accountbook.api;

import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.http.converter.ByteArrayHttpMessageConverter;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.converter.HttpMessageConverters;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * 구조가 있는 본문은 JSON만 받고 낸다(ADR 001 결정 5, ADR 003 결정 9). 실행 경로에 YAML, XML, CBOR 라이브러리가 들어와도
 * 그 변환기를 쓰지 않는다. 남기는 것은 JSON 계열({@code application/json}, {@code application/*+json}. problem+json과
 * actuator 응답이 여기에 든다)과 내보내기 파일을 쓰는 바이트 변환기다. 글자와 파일(Resource) 변환기는 쓰는 API가 없어 뺀다.
 */
@Configuration(proxyBeanMethods = false)
class JsonOnlyConverterConfig implements WebMvcConfigurer {

    @Override
    public void configureMessageConverters(HttpMessageConverters.ServerBuilder builder) {
        builder.configureMessageConvertersList(converters -> converters.removeIf(c -> !keep(c)));
    }

    static boolean keep(HttpMessageConverter<?> converter) {
        if (converter instanceof ByteArrayHttpMessageConverter) {
            return true;
        }
        return !converter.getSupportedMediaTypes().isEmpty()
                && converter.getSupportedMediaTypes().stream().allMatch(JsonOnlyConverterConfig::isJson);
    }

    private static boolean isJson(MediaType type) {
        return type.getType().equals("application")
                && (type.getSubtype().equals("json") || type.getSubtype().endsWith("+json"));
    }
}
