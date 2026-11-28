package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.support.SignedInUser;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import java.time.Instant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;

/**
 * 구조가 있는 본문은 JSON만 받고 낸다(ADR 003 결정 9). {@code consumes}와 {@code produces}가 없는 주소에 보내서
 * 매핑이 아니라 변환기가 거절하는 것을 본다. 테스트의 실행 경로에는 springdoc이 들여온 YAML과 JAXB(XML) 라이브러리가 있다.
 */
@AccessTest
class JsonOnlyConverterTest {

    private static final Instant NOW = Instant.parse("2030-01-01T00:00:00Z");
    private static final String ID = SignedInUser.ID.toString();
    private static final String PATH = AccessProbeController.PATH + "/users/" + ID + "?userId=" + ID;

    @LocalServerPort int port;
    @Autowired StoppedClock clock;

    private ServerClient server;

    @BeforeEach
    void setUp() {
        clock.stopAt(NOW);
        server = ServerClient.signedIn(port, SignedInUser.ID, NOW);
    }

    @ParameterizedTest
    @ValueSource(strings = {"application/yaml", "application/xml", "text/xml", "application/cbor"})
    void JSON이_아닌_구조_있는_본문은_415다(String contentType) throws Exception {
        server.send("POST", PATH, "a: b", "X-User-Id", ID, "Content-Type", contentType)
                .assertProblem(415, "Unsupported Media Type", "UNSUPPORTED_MEDIA_TYPE");
    }

    @ParameterizedTest
    @ValueSource(strings = {"application/yaml", "application/xml", "text/xml", "application/cbor"})
    void 응답을_JSON이_아닌_형식으로만_달라면_400이다(String accept) throws Exception {
        server.send("POST", PATH, "{}", "X-User-Id", ID, "Content-Type", "application/json", "Accept", accept)
                .assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
    }

    @Test
    void JSON은_그대로_받고_낸다() throws Exception {
        ServerClient.Reply reply = server.send("POST", PATH, "{}", "X-User-Id", ID, "Content-Type",
                "application/json", "Accept", "application/json");

        assertThat(reply.status()).isEqualTo(200);
        assertThat(reply.header("Content-Type")).isEqualTo("application/json");
        assertThat(reply.json().get("userId").asString()).isEqualTo(ID);
    }
}
