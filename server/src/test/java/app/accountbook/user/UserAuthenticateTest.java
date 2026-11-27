package app.accountbook.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.params.provider.Arguments.argumentSet;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import app.accountbook.support.CapturedLogs;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import java.text.Normalizer;
import java.text.Normalizer.Form;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

/**
 * 로그인의 이메일과 비밀번호 확인(#12, ADR 001 결정 7). 실패는 이유를 나누지 않고, 가입 여부와 무관하게 해시 비교를 한 번 한다.
 * 걸린 시간이 아니라 인코더가 불린 수로 본다. 스프링 컨텍스트 없이 돈다.
 */
class UserAuthenticateTest {

    private static final PasswordHashProperties PROPERTIES = new PasswordHashProperties(4, 16, Duration.ofSeconds(2));
    private static final String EMAIL = "marker-user@example.com";
    private static final String PASSWORD = "marker-Password1";
    private static final String LIGHT = "$argon2id$v=19$m=256,t=1,p=1$";
    private static final Logger OURS = (Logger) LoggerFactory.getLogger("app.accountbook");

    private final PasswordEncoder encoder = spy(new Argon2PasswordEncoder(16, 32, 1, 256, 1));
    private final PasswordHasher hasher = new PasswordHasher(encoder, PROPERTIES);
    private final UserRepository users = mock();
    private final UserService service = service(hasher);
    private CapturedLogs logs;

    @BeforeEach
    void setUp() {
        OURS.setLevel(Level.TRACE);
        logs = CapturedLogs.start();
        OURS.trace("로그 수집 확인");
    }

    @AfterEach
    void tearDown() {
        logs.close();
        OURS.setLevel(null);
    }

    // --- 성공 ---

    @Test
    void 이메일과_비밀번호가_맞으면_사용자_id를_주고_한_번_비교한다() {
        User user = signedUp(hasher.hash(PASSWORD));

        assertThat(service.authenticate(EMAIL, PASSWORD)).contains(user.getId());

        verify(encoder, times(1)).matches(any(), any());
        assertThat(requestLogs()).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"MARKER-User@Example.COM", " marker-user@example.com", "\tmarker-user@example.com \r\n"})
    void 이메일은_가입과_같은_방식으로_맞춘다(String email) {
        User user = signedUp(hasher.hash(PASSWORD));

        assertThat(service.authenticate(email, PASSWORD)).contains(user.getId());
    }

    static Stream<Arguments> samePasswords() {
        return Stream.of(
                argumentSet("분해형 한글", Normalizer.normalize("비밀번호abc1", Form.NFD), "비밀번호abc1"),
                argumentSet("전각 영문과 숫자", "ａｂｃｄｅｆｇ１", "abcdefg1"),
                argumentSet("둘 다", Normalizer.normalize("비밀번호", Form.NFD) + "ａｂｃ１", "비밀번호abc1"));
    }

    @ParameterizedTest
    @MethodSource("samePasswords")
    void 비밀번호는_NFKC로_맞춰_비교한다(String one, String other) {
        User user = signedUp(hasher.hash(one));
        assertThat(service.authenticate(EMAIL, other)).contains(user.getId());

        user = signedUp(hasher.hash(other));
        assertThat(service.authenticate(EMAIL, one)).contains(user.getId());
    }

    @Test
    void 맞춘_비밀번호가_72자이고_맞추기_전이_512자인_것까지_비교한다() {
        User user = signedUp(hasher.hash("a1" + "가".repeat(70)));

        assertThat(service.authenticate(EMAIL, Normalizer.normalize("a1" + "가".repeat(70), Form.NFD)))
                .contains(user.getId());
        assertThat(service.authenticate(EMAIL, "x".repeat(72))).isEmpty();
        // NFKC로 줄어드는 입력: 결합 문자 둘이 한 글자로 합쳐진다.
        assertThat(service.authenticate(EMAIL, "a1" + "각".repeat(70))).isEmpty();
        verify(encoder, times(3)).matches(any(), any());
    }

    @Test
    void 맞춘_비밀번호의_길이는_유니코드_글자_수로_센다() {
        // UTF-16으로는 142단위다. 가입이 받은 비밀번호로 로그인할 수 있어야 한다.
        String password = "a1" + "\uD83D\uDE00".repeat(70);
        User user = signedUp(hasher.hash(password));

        assertThat(service.authenticate(EMAIL, password)).contains(user.getId());
        assertThat(service.authenticate(EMAIL, password + "\uD83D\uDE00")).isEmpty();
        verify(encoder, times(1)).matches(any(), any());
    }

    @Test
    void 지금_규칙에_맞지_않아도_저장된_비밀번호와_비교한다() {
        User user = signedUp(encoder.encode("old"));

        assertThat(service.authenticate(EMAIL, "old")).contains(user.getId());
    }

    // --- 실패: 모두 빈 값이고 해시 비교를 한 번 한다 ---

    static Stream<Arguments> failures() {
        String bcrypt = new BCryptPasswordEncoder(4).encode(PASSWORD);
        return Stream.of(
                argumentSet("틀린 비밀번호", LIGHT + "YWNjb3VudC1ib29rLXRzdA$vHygWA0jNvBLxOELjrkU6R1OAPyuN/Ro9FrihcYD2KI", EMAIL),
                argumentSet("{noop} 저장값", "{noop}" + PASSWORD, EMAIL),
                argumentSet("평문 저장값", PASSWORD, EMAIL),
                argumentSet("bcrypt 저장값", bcrypt, EMAIL),
                argumentSet("{bcrypt} 저장값", "{bcrypt}" + bcrypt, EMAIL),
                argumentSet("빈 저장값", "", EMAIL),
                argumentSet("저장값이 없다", null, EMAIL),
                argumentSet("매개변수가 상한을 넘는 저장값",
                        "$argon2id$v=19$m=2097152,t=1,p=1$YWNjb3VudC1ib29rLXRzdA$vHygWA0jNvBLxOELjrkU6R1OAPyuN/Ro9FrihcYD2KI",
                        EMAIL),
                argumentSet("없는 이메일", null, "marker-nobody@example.com"),
                argumentSet("골뱅이가 없다", null, "marker-nobody"),
                argumentSet("골뱅이가 둘이다", null, "marker-user@@example.com"),
                argumentSet("ASCII가 아니다", null, "marker-사용자@example.com"),
                argumentSet("소문자로 바꾸면 ASCII가 되는 글자", null, "marKer-user@example.com"),
                argumentSet("가운데 공백", null, "marker-user @example.com"),
                argumentSet("255자 이메일", null, "marker-" + "a".repeat(236) + "@example.com"),
                argumentSet("아주 긴 이메일", null, "marker-user@example.com".repeat(10_000)),
                argumentSet("빈 이메일", null, ""),
                argumentSet("이메일이 null", null, null));
    }

    @ParameterizedTest
    @MethodSource("failures")
    void 실패는_모두_빈_값이고_비교를_한_번_한다(String stored, String email) {
        signedUp(stored);

        assertThat(service.authenticate(email, PASSWORD)).isEmpty();

        ArgumentCaptor<String> compared = ArgumentCaptor.forClass(String.class);
        verify(encoder, times(1)).matches(eq(PASSWORD), compared.capture());
        assertThat(StoredPasswordHash.isComparable(compared.getValue())).isTrue();
        assertThat(compared.getValue()).startsWith(LIGHT);
    }

    @ParameterizedTest
    @MethodSource("failures")
    void 가짜_저장값과_맞았다고_나와도_로그인되지_않는다(String stored, String email) {
        if (stored != null && StoredPasswordHash.isComparable(stored)) {
            return; // 가짜가 아니라 자기 저장값과 비교하는 경우다.
        }
        signedUp(stored);
        doReturn(true).when(encoder).matches(any(), any());

        assertThat(service.authenticate(email, PASSWORD)).isEmpty();

        verify(encoder, times(1)).matches(any(), any());
    }

    @Test
    void 형식이_틀린_이메일은_조회하지_않는다() {
        service.authenticate("marker-nobody", PASSWORD);

        verifyNoInteractions(users);
    }

    // --- 비교할 수 없는 비밀번호: 가입 여부와 무관하게 조회도 비교도 하지 않는다 ---

    static Stream<Arguments> passwordsNotCompared() {
        return Stream.of(
                argumentSet("정규화 전 513자", "a".repeat(513)),
                argumentSet("아주 길다", "marker-Password1".repeat(100_000)),
                argumentSet("맞추면 줄어들어도 정규화 전 513자를 넘는다", "a1" + "각".repeat(171)),
                argumentSet("정규화 뒤 73자", "a1" + "가".repeat(71)),
                argumentSet("정규화하면 늘어나 73자를 넘는다", "a1" + "ﷺ".repeat(5)),
                argumentSet("짝 없는 서로게이트", "marker-Password1\uD800"),
                argumentSet("null", (Object) null));
    }

    @ParameterizedTest
    @MethodSource("passwordsNotCompared")
    void 비교할_수_없는_비밀번호는_가입_여부와_무관하게_조회도_비교도_하지_않는다(String password) {
        signedUp(hasher.hash(PASSWORD));

        assertThat(service.authenticate(EMAIL, password)).isEmpty();
        assertThat(service.authenticate("marker-nobody@example.com", password)).isEmpty();
        assertThat(service.authenticate("marker-nobody", password)).isEmpty();

        verify(encoder, never()).matches(any(), any());
        verifyNoInteractions(users);
        assertThat(requestLogs()).extracting(ILoggingEvent::getFormattedMessage)
                .containsExactly("로그인 실패: 알 수 없는 계정", "로그인 실패: 알 수 없는 계정", "로그인 실패: 알 수 없는 계정");
    }

    // --- 가짜 저장값 ---

    @Test
    void 가짜_저장값은_운영_매개변수로_만든_Argon2id_값이다() {
        PasswordEncoder production = spy(PasswordEncoderConfig.argon2id());
        UserService productionService = service(new PasswordHasher(production, PROPERTIES));

        assertThat(productionService.authenticate("marker-nobody@example.com", PASSWORD)).isEmpty();

        ArgumentCaptor<String> compared = ArgumentCaptor.forClass(String.class);
        verify(production, times(1)).matches(eq(PASSWORD), compared.capture());
        assertThat(compared.getValue()).startsWith("$argon2id$v=19$m=19456,t=2,p=1$");
        assertThat(StoredPasswordHash.isComparable(compared.getValue())).isTrue();
    }

    @Test
    void 가짜_저장값은_기동할_때_한_번_만들고_기동마다_다르다() {
        clearInvocations(encoder);

        service.authenticate("marker-nobody@example.com", PASSWORD);
        service.authenticate("marker-nobody", PASSWORD);
        service(hasher).authenticate("marker-nobody", PASSWORD);

        ArgumentCaptor<String> compared = ArgumentCaptor.forClass(String.class);
        verify(encoder, times(3)).matches(any(), compared.capture());
        assertThat(compared.getAllValues().get(0)).isEqualTo(compared.getAllValues().get(1))
                .isNotEqualTo(compared.getAllValues().get(2));
        // 로그인하는 동안에는 해시를 만들지 않는다. 마지막 service를 만들 때의 한 번뿐이다.
        verify(encoder, times(1)).encode(any());
    }

    @Test
    void 통합_테스트용_입구가_만드는_값도_비교할_수_있다() {
        // 비교할 수 없는 값이면 통합 테스트에서 가짜 비교가 조용히 빠진다.
        String stored = new TestPasswordHasherConfig().lightPasswordHasher().hash(PASSWORD);

        assertThat(StoredPasswordHash.isComparable(stored)).isTrue();
    }

    // --- 해시 자리와 DB ---

    @ParameterizedTest
    @ValueSource(strings = {EMAIL, "marker-nobody@example.com", "marker-nobody"})
    void 해시_자리가_없으면_가입_여부와_무관하게_같은_예외다(String email) {
        signedUp(hasher.hash(PASSWORD));
        doThrow(new PasswordHashBusyException()).when(encoder).matches(any(), any());

        assertThatThrownBy(() -> service.authenticate(email, PASSWORD)).isInstanceOf(PasswordHashBusyException.class);

        assertThat(requestLogs()).isEmpty();
    }

    @Test
    void 사용자를_조회하지_못하면_로그인_실패가_아니라_예외다() {
        when(users.findByEmail(any())).thenThrow(new DataAccessResourceFailureException("DB에 닿지 못함"));

        assertThatThrownBy(() -> service.authenticate(EMAIL, PASSWORD))
                .isInstanceOf(DataAccessResourceFailureException.class);
    }

    // --- 로그 ---

    @Test
    void 가입한_사용자의_실패는_사용자_id로_한_줄_남는다() {
        User user = signedUp(hasher.hash("other-Password1"));

        service.authenticate(EMAIL, PASSWORD);

        assertThat(requestLogs()).singleElement().satisfies(event -> {
            assertThat(event.getLevel()).isEqualTo(Level.INFO);
            assertThat(event.getFormattedMessage()).isEqualTo("로그인 실패: 사용자 " + user.getId());
            assertThat(event.getThrowableProxy()).isNull();
        });
    }

    @Test
    void 저장값이_비교할_수_없는_사용자의_실패도_사용자_id로_남는다() {
        User user = signedUp("{noop}" + PASSWORD);

        service.authenticate(EMAIL, PASSWORD);

        assertThat(requestLogs()).extracting(ILoggingEvent::getFormattedMessage)
                .containsExactly("로그인 실패: 사용자 " + user.getId());
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"marker-nobody@example.com", "marker-nobody"})
    void 없는_사용자의_실패는_알_수_없는_계정으로_한_줄_남는다(String email) {
        signedUp(hasher.hash(PASSWORD));

        service.authenticate(email, PASSWORD);

        assertThat(requestLogs()).singleElement().satisfies(event -> {
            assertThat(event.getLevel()).isEqualTo(Level.INFO);
            assertThat(event.getFormattedMessage()).isEqualTo("로그인 실패: 알 수 없는 계정");
            assertThat(event.getThrowableProxy()).isNull();
        });
    }

    @ParameterizedTest
    @MethodSource("failures")
    void 이메일과_비밀번호와_저장값은_로그에_없다(String stored, String email) {
        signedUp(stored);

        service.authenticate(email, PASSWORD);
        service.authenticate(email, PASSWORD + "\uD800");
        service.authenticate(email, PASSWORD.repeat(40));

        assertThat(logs.text()).contains("로그 수집 확인")
                .doesNotContainIgnoringCase("marker").doesNotContain("argon2id", "noop", "bcrypt", "example.com");
    }

    private UserService service(PasswordHasher passwordHasher) {
        return new UserService(users, mock(), mock(), mock(), passwordHasher, mock(), mock());
    }

    /** EMAIL로 가입한 사용자. 여기까지 만든 해시는 세지 않는다. */
    private User signedUp(String stored) {
        User user = User.of(EMAIL, stored, "이름");
        when(users.findByEmail(EMAIL)).thenReturn(Optional.of(user));
        clearInvocations(encoder, users);
        return user;
    }

    /** 이 스레드의 로그. 다른 컨텍스트의 스레드가 같은 때 남긴 것은 뺀다. */
    private List<ILoggingEvent> requestLogs() {
        return logs.events().stream()
                .filter(event -> event.getThreadName().equals(Thread.currentThread().getName()))
                .filter(event -> !event.getFormattedMessage().equals("로그 수집 확인"))
                .toList();
    }
}
