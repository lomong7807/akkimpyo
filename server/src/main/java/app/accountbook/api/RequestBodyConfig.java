package app.accountbook.api;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(RequestBodyProperties.class)
class RequestBodyConfig {

    @Bean
    RequestBodyLimitFilter requestBodyLimitFilter(RequestBodyProperties properties) {
        return new RequestBodyLimitFilter(properties);
    }
}
