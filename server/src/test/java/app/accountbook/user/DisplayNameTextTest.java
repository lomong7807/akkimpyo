package app.accountbook.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.support.IntegrationTest;
import java.text.Normalizer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 표시 이름의 글자 규칙(P-101, P-214, #123): 조합형으로 맞춰 저장하고 글자 수도 그 값으로 센다. 거부 글자와 짝 없는
 * 서로게이트를 막고, 앞뒤 공백류를 지우고, 공백류뿐이면 빈 이름이다. 입력란은 {@code displayName}이다.
 * 규칙 하나하나는 common.UserTextTest가 본다.
 */
@IntegrationTest
class DisplayNameTextTest {

    private static final String PASSWORD = "password1";

    @Autowired UserService userService;
    @Autowired UserRepository userRepository;
    @Autowired JdbcTemplate jdbc;

    @Test
    void decomposedDisplayNameIsStoredComposed() {
        User user = userService.createUser("nfd@example.com", PASSWORD, nfd("아낌이"));

        assertThat(storedDisplayName(user)).isEqualTo("아낌이").hasSize(3);
    }

    @Test
    void twentyDecomposedHangulCharactersAreStored() {
        String decomposedTwenty = nfd("가각간갇갈감갑갓강갖갗같갚갛개객갠갤갬갭");

        assertThat(storedDisplayName(userService.createUser("twenty@example.com", PASSWORD, decomposedTwenty)))
                .hasSize(20);
        assertRejected("twentyone@example.com", nfd("가".repeat(21)), FieldErrorCode.TOO_LONG);
    }

    @Test
    void spacesAroundAreTrimmed() {
        User user = userService.createUser("trim@example.com", PASSWORD, "　 아낌 표 ");

        assertThat(storedDisplayName(user)).isEqualTo("아낌 표");
    }

    @ParameterizedTest
    @ValueSource(strings = {" ", "　", "　   "})
    void displayNameOfOnlySpacesIsRequired(String displayName) {
        assertRejected("blank@example.com", displayName, FieldErrorCode.REQUIRED);
    }

    @ParameterizedTest
    @ValueSource(strings = {"아낌​이", "아낌이‍", "아낌이️", "ㅤ", "아낌‮이", "아낌\t이",
            "아낌\u0000이", "아낌\uD800이", "\uDC00아낌이"})
    void forbiddenCharactersAndUnpairedSurrogatesAreRejected(String displayName) {
        assertRejected("bad@example.com", displayName, FieldErrorCode.INVALID_FORMAT);
    }

    @Test
    void emojiIsKept() {
        String family = "👨‍👩‍👧";

        assertThat(storedDisplayName(userService.createUser("emoji@example.com", PASSWORD, "아낌 " + family)))
                .isEqualTo("아낌 " + family);
    }

    /** 거부되면 사용자도 장부도 남지 않고, 입력란은 displayName이다. */
    private void assertRejected(String email, String displayName, FieldErrorCode code) {
        long usersBefore = userRepository.count();

        InvalidRequestException e = catchThrowableOfType(InvalidRequestException.class,
                () -> userService.createUser(email, PASSWORD, displayName));

        assertThat(e).isNotNull();
        assertThat(e.field()).isEqualTo("displayName");
        assertThat(e.code()).isEqualTo(code);
        assertThat(userRepository.count()).isEqualTo(usersBefore);
        assertThat(userRepository.existsByEmail(email)).isFalse();
    }

    /** 영속성 컨텍스트를 거치지 않고 DB에 저장된 값을 읽는다. */
    private String storedDisplayName(User user) {
        userRepository.flush();
        return jdbc.queryForObject("select display_name from users where id = ?", String.class, user.getId());
    }

    private static String nfd(String text) {
        return Normalizer.normalize(text, Normalizer.Form.NFD);
    }
}
