package app.accountbook.api;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import org.springframework.boot.autoconfigure.ImportAutoConfiguration;
import org.springframework.boot.autoconfigure.context.ConfigurationPropertiesAutoConfiguration;
import org.springframework.boot.http.converter.autoconfigure.HttpMessageConvertersAutoConfiguration;
import org.springframework.boot.jackson.autoconfigure.JacksonAutoConfiguration;
import org.springframework.boot.servlet.autoconfigure.HttpEncodingAutoConfiguration;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.boot.tomcat.autoconfigure.servlet.TomcatServletWebServerAutoConfiguration;
import org.springframework.boot.webmvc.autoconfigure.DispatcherServletAutoConfiguration;
import org.springframework.boot.webmvc.autoconfigure.WebMvcAutoConfiguration;
import org.springframework.boot.webmvc.autoconfigure.error.ErrorMvcAutoConfiguration;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;

/**
 * 실제 Tomcat에 api의 공통 처리(필터, 오류 응답)만 띄운다. DB가 필요 없고, 자동 설정을 하나씩 적어 앱의 다른 필터가 끼어들지 않는다.
 * 앱 전체에서의 자리는 {@link RequestBodyLimitAppTest}가 본다. 본문을 기다리는 시간은 시험할 수 있게 줄인다.
 */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@SpringBootTest(classes = BodyLimitServerTest.Server.class, webEnvironment = WebEnvironment.RANDOM_PORT)
@TestPropertySource(properties = "server.tomcat.connection-timeout=3s")
@interface BodyLimitServerTest {

    /** 컴포넌트 검색에 걸리지 않게 설정 애노테이션을 붙이지 않는다. */
    @ImportAutoConfiguration({TomcatServletWebServerAutoConfiguration.class, DispatcherServletAutoConfiguration.class,
            WebMvcAutoConfiguration.class, ErrorMvcAutoConfiguration.class, HttpEncodingAutoConfiguration.class,
            HttpMessageConvertersAutoConfiguration.class, JacksonAutoConfiguration.class,
            ConfigurationPropertiesAutoConfiguration.class})
    @Import({RequestBoundaryFilter.class, ApiErrorController.class, ApiExceptionHandler.class,
            TomcatErrorConfig.class, RequestBodyConfig.class, BodyProbeController.class, BodyProbeFilters.class})
    class Server {
    }
}
