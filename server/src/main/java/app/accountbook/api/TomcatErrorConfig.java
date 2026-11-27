package app.accountbook.api;

import org.springframework.boot.tomcat.ConfigurableTomcatWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import tools.jackson.databind.json.JsonMapper;

@Configuration(proxyBeanMethods = false)
class TomcatErrorConfig {

    /** 스프링 부트가 더한 HTML 오류 밸브보다 안쪽에 둔다. 안쪽이 먼저 답한다. */
    @Bean
    WebServerFactoryCustomizer<ConfigurableTomcatWebServerFactory> problemErrorReport(JsonMapper jsonMapper) {
        return factory -> factory.addContextCustomizers(context ->
                context.getParent().getPipeline().addValve(new ProblemErrorReportValve(jsonMapper)));
    }
}
