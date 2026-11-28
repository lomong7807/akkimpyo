package app.accountbook;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.security.autoconfigure.UserDetailsServiceAutoConfiguration;

/** 스프링 부트가 만드는 기본 계정을 쓰지 않는다. 켜 두면 만든 비밀번호를 로그에 남긴다. */
@SpringBootApplication(exclude = UserDetailsServiceAutoConfiguration.class)
public class AccountBookApplication {

    public static void main(String[] args) {
        SpringApplication.run(AccountBookApplication.class, args);
    }
}
