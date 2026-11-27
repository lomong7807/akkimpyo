package app.accountbook.common;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Supplier;
import java.util.stream.Collectors;
import org.springframework.beans.factory.BeanCreationException;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.boot.jdbc.autoconfigure.JdbcConnectionDetails;
import org.springframework.stereotype.Component;

/**
 * DB 접속 설정이 빠진 채로 기동하지 않게 막는다.
 * application.yml의 {@code ${DB_URL}} 같은 자리는 변수가 없어도 오류 없이 글자 그대로 남는다.
 * 그 글자가 접속 정보로 쓰이기 직전에 잡아, 빠진 변수 이름만 알리고 멈춘다(값은 메시지에 넣지 않는다).
 * 빈 값과 공백뿐인 값도 빠진 것으로 본다(Docker compose는 env 파일에 없는 변수를 빈 문자열로 넘긴다).
 * 접속 정보가 설정 파일이 아닌 곳에서 오면(테스트의 Testcontainers) 걸리지 않는다.
 */
@Component
public class RequiredDbSettings implements BeanPostProcessor {

    @Override
    public Object postProcessAfterInitialization(Object bean, String beanName) {
        if (bean instanceof JdbcConnectionDetails details) {
            Map<String, Supplier<String>> settings = new LinkedHashMap<>();
            settings.put("DB_URL", details::getJdbcUrl);
            settings.put("DB_USERNAME", details::getUsername);
            settings.put("DB_PASSWORD", details::getPassword);
            String missing = settings.entrySet().stream()
                    .filter(setting -> isMissing(setting.getKey(), setting.getValue()))
                    .map(Map.Entry::getKey)
                    .collect(Collectors.joining(", "));
            if (!missing.isEmpty()) {
                throw new IllegalStateException("DB 접속 설정이 없습니다. 환경 변수 " + missing
                        + "을(를) 설정하세요. 로컬 개발이라면 SPRING_PROFILES_ACTIVE=local 로 실행합니다.");
            }
        }
        return bean;
    }

    private static boolean isMissing(String variable, Supplier<String> setting) {
        try {
            String value = setting.get();
            return value == null || value.isBlank() || ("${" + variable + "}").equals(value);
        } catch (BeanCreationException e) {
            // URL이 비어 있으면 Spring Boot가 값을 돌려주지 않고 "Failed to determine suitable jdbc url"을 던진다.
            return true;
        }
    }
}
