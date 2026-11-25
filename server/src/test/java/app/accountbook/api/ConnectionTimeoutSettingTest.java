package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import org.apache.coyote.http11.AbstractHttp11Protocol;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.boot.tomcat.TomcatWebServer;
import org.springframework.boot.web.server.servlet.context.ServletWebServerApplicationContext;

/** 보내다 멈춘 연결을 기다리는 시간의 설정(#21). 값이 하는 일은 {@link ConnectionTimeoutTest}가 짧은 값으로 본다. DB 없이 돈다. */
@SpringBootTest(classes = BodyLimitServerTest.Server.class, webEnvironment = WebEnvironment.RANDOM_PORT)
class ConnectionTimeoutSettingTest {

    @Autowired ServletWebServerApplicationContext context;

    @Test
    void 머리와_본문과_유지_연결을_10초까지_기다린다() {
        AbstractHttp11Protocol<?> protocol = (AbstractHttp11Protocol<?>) ((TomcatWebServer) context.getWebServer())
                .getTomcat().getConnector().getProtocolHandler();

        assertThat(protocol.getConnectionTimeout()).isEqualTo(10_000);
        // 본문을 읽을 때 다른 값(connectionUploadTimeout)을 쓰지 않는다.
        assertThat(protocol.getDisableUploadTimeout()).isTrue();
        // 따로 정하지 않으면 유지 연결도 같은 값을 따른다.
        assertThat(protocol.getKeepAliveTimeout()).isEqualTo(10_000);
    }
}
