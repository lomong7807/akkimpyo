package app.accountbook.user;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.support.IntegrationTest;
import java.text.Normalizer;
import java.text.Normalizer.Form;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/** 가입한 값으로 로그인한다(#12). 갈래는 UserAuthenticateTest가 보고, 여기서는 가입과 같은 DB를 지난 결과를 본다. */
@IntegrationTest
class UserAuthenticationTest {

    @Autowired UserService userService;
    @Autowired JdbcTemplate jdbc;

    @ParameterizedTest
    @CsvSource({"User@Example.com, user@example.com", "user@example.com, USER@EXAMPLE.COM",
            "' user@example.com', 'user@example.com\t'"})
    void 가입한_이메일의_대소문자와_앞뒤_공백은_달라도_된다(String signup, String login) {
        UUID userId = userService.createUser(signup, "password1", "주인").getId();

        assertThat(userService.authenticate(login, "password1")).contains(userId);
    }

    @Test
    void 분해형_한글과_전각으로_가입한_비밀번호는_조합형과_반각으로_로그인되고_반대도_된다() {
        String composed = "비밀번호abc1";
        String decomposed = Normalizer.normalize("비밀번호", Form.NFD) + "ａｂｃ１";
        UUID first = userService.createUser("first@example.com", decomposed, "하나").getId();
        UUID second = userService.createUser("second@example.com", composed, "둘").getId();

        assertThat(userService.authenticate("first@example.com", composed)).contains(first);
        assertThat(userService.authenticate("second@example.com", decomposed)).contains(second);
        assertThat(userService.authenticate("first@example.com", composed + "2")).isEmpty();
    }

    @Test
    void 다른_사람의_비밀번호로는_로그인되지_않는다() {
        userService.createUser("first@example.com", "password1", "하나");
        UUID second = userService.createUser("second@example.com", "password2", "둘").getId();

        assertThat(userService.authenticate("first@example.com", "password2")).isEmpty();
        assertThat(userService.authenticate("second@example.com", "password2")).contains(second);
        assertThat(userService.authenticate("third@example.com", "password1")).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"{noop}password1", "password1", "", "$argon2id$v=19$m=256,t=1,p=1$x$y"})
    void 다른_모양의_저장값으로는_로그인되지_않는다(String stored) {
        jdbc.update("""
                insert into users (id, email, password_hash, display_name, created_at)
                values (?, 'stored@example.com', ?, '이름', now())
                """, UUID.randomUUID(), stored);

        assertThat(userService.authenticate("stored@example.com", "password1")).isEmpty();
        assertThat(userService.authenticate("stored@example.com", stored + "password1")).isEmpty();
    }
}
