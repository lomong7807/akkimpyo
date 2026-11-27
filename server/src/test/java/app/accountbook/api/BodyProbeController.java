package app.accountbook.api;

import java.io.IOException;
import java.io.InputStream;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import org.springframework.boot.test.context.TestComponent;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** 본문이 컨트롤러에 어떻게 닿는지 보는 테스트용 컨트롤러. 받은 값은 되돌리지 않고 길이와 지문만 답한다. */
@TestComponent
@RestController
@RequestMapping(BodyProbeController.PATH)
class BodyProbeController {

    static final String PATH = "/test/body";
    static final String BYTES = PATH + "/bytes";
    static final String TEXT = PATH + "/text";
    static final String JSON = PATH + "/json";
    static final String FORM = PATH + "/form";
    static final String NONE = PATH + "/none";

    @RequestMapping("/bytes")
    Received bytes(InputStream body) throws IOException {
        return Received.of(body.readAllBytes());
    }

    @PostMapping("/text")
    Received text(Reader body) throws IOException {
        StringBuilder text = new StringBuilder();
        char[] buffer = new char[4096];
        for (int n = body.read(buffer); n >= 0; n = body.read(buffer)) {
            text.append(buffer, 0, n);
        }
        return Received.of(text.toString().getBytes(StandardCharsets.UTF_8));
    }

    @RequestMapping(path = "/json", method = {RequestMethod.POST, RequestMethod.PUT, RequestMethod.PATCH})
    Received json(@RequestBody Command command) {
        return Received.of(command.text().getBytes(StandardCharsets.UTF_8));
    }

    /** 폼의 값은 프레임워크가 본문을 읽어 채운다. */
    @PostMapping("/form")
    Received form(@RequestParam(defaultValue = "") String text) {
        return Received.of(text.getBytes(StandardCharsets.UTF_8));
    }

    /** 로그아웃, 갱신처럼 본문을 받지 않는다. */
    @RequestMapping("/none")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void none() {
    }

    record Command(String text) {
    }

    record Received(int length, String sha256) {

        static Received of(byte[] body) {
            try {
                return new Received(body.length,
                        HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(body)));
            } catch (NoSuchAlgorithmException e) {
                throw new IllegalStateException(e);
            }
        }
    }
}
