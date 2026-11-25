package app.accountbook.user;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * 동시에 도는 비밀번호 해시의 상한과 자리를 기다리는 시간(ADR 001 결정 7, #20). 잘못된 값이면 서버가 뜨지 않는다.
 * 해시 하나가 19MiB를 쓰므로 상한을 올리면 서버 메모리 상한(#52)도 같이 본다.
 *
 * @param maxConcurrent 동시에 도는 해시 수. 가입의 해시와 로그인의 비교를 합쳐 센다
 * @param maxWait       자리가 없을 때 기다리는 최대 시간. 단위를 붙여 적는다(예: {@code 2s}, {@code 500ms})
 */
@ConfigurationProperties("accountbook.password-hash")
record PasswordHashProperties(@DefaultValue("4") int maxConcurrent, @DefaultValue("2s") Duration maxWait) {

    PasswordHashProperties {
        if (maxConcurrent < 1) {
            throw new IllegalArgumentException(
                    "accountbook.password-hash.max-concurrent는 1 이상이어야 합니다: " + maxConcurrent);
        }
        if (!maxWait.isPositive()) {
            throw new IllegalArgumentException(
                    "accountbook.password-hash.max-wait는 0보다 길어야 합니다: " + maxWait);
        }
    }
}
