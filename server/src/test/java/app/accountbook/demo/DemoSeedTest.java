package app.accountbook.demo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.accountbook.account.Account;
import app.accountbook.account.AccountService;
import app.accountbook.account.AccountType;
import app.accountbook.auth.LoginService;
import app.accountbook.category.CategoryService;
import app.accountbook.ledger.LedgerRole;
import app.accountbook.ledger.LedgerService;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.transaction.TransactionService;
import app.accountbook.user.User;
import app.accountbook.user.UserService;
import jakarta.persistence.EntityManager;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;
import org.springframework.context.support.StaticApplicationContext;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

/** 데모 데이터 넣기·지우기(#349). 컨텍스트를 늘리지 않게 공용 컨텍스트의 서비스와 local 환경으로 DemoSeed를 직접 만든다. */
@IntegrationTest
class DemoSeedTest {

    /** 서울은 2026-03-01 00:30이고 UTC는 아직 2월 28일이다. */
    private static final Instant SEOUL_MARCH_FIRST = Instant.parse("2026-02-28T15:30:00Z");
    private static final String OTHER_EMAIL = "other-user@example.com";

    private final StaticApplicationContext seedContext = new StaticApplicationContext();
    private final ConfigurableEnvironment environment = seedContext.getEnvironment();
    private DemoSeed seed;

    @Autowired
    ApplicationContext app;

    @Autowired
    Fixtures fixtures;

    @Autowired
    LoginService loginService;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    EntityManager entityManager;

    @BeforeEach
    void localSeed() {
        environment.setActiveProfiles(DemoSeed.PROFILE);
        StoppedClock clock = new StoppedClock();
        clock.stopAt(SEOUL_MARCH_FIRST);
        seed = new DemoSeed(app.getBean(UserService.class), app.getBean(LedgerService.class),
                app.getBean(AccountService.class), app.getBean(CategoryService.class),
                app.getBean(TransactionService.class), jdbc, app.getBean(TransactionTemplate.class), seedContext,
                clock);
    }

    @Test
    void 넣으면_장부_하나와_계좌_3개_기본_카테고리_서울_날짜의_거래가_생기고_두_번째_넣기는_아무것도_더하지_않는다() {
        assertThat(seed.insert()).isTrue();

        UUID ledgerId = demoLedgerId();
        assertThat(jdbc.queryForList("select name from account where ledger_id = ?", String.class, ledgerId))
                .containsExactlyInAnyOrder("지갑", "생활비 통장", "신용카드");
        assertThat(count("select count(*) from category where ledger_id = ?", ledgerId)).isEqualTo(17);
        assertThat(jdbc.queryForList("select type from transaction where ledger_id = ?", String.class, ledgerId))
                .hasSize(DemoSamples.SAMPLES.size())
                .contains("EXPENSE", "INCOME", "TRANSFER");
        // 이번 달 거래는 모두 서울의 오늘(3월 1일)이고, 지난달의 31일 거래는 2월 28일이다.
        assertThat(jdbc.queryForList("select occurred_on from transaction where ledger_id = ?", LocalDate.class,
                ledgerId))
                .allMatch(on -> !on.isBefore(LocalDate.of(2026, 2, 1)) && !on.isAfter(LocalDate.of(2026, 3, 1)))
                .contains(LocalDate.of(2026, 3, 1), LocalDate.of(2026, 2, 28));

        Map<String, Integer> once = rowCounts();
        assertThat(seed.insert()).isFalse();
        assertThat(rowCounts()).isEqualTo(once);
    }

    @Test
    void 지우면_데모_계정의_행을_모두_지우고_다른_사용자의_데이터는_남긴다() {
        User other = fixtures.user(OTHER_EMAIL);
        UUID otherLedger = fixtures.personalLedgerId(other);
        Account otherAccount = fixtures.account(other, otherLedger, "다른 통장", AccountType.BANK, 10_000,
                LocalDate.of(2026, 2, 1));
        fixtures.expense(other, otherLedger, otherAccount.getId(), null, LocalDate.of(2026, 2, 27), 5_000);
        loginService.login(OTHER_EMAIL, "password1", null);
        Map<String, Integer> before = rowCounts();

        seed.insert();
        loginService.login(DemoSeed.EMAIL, DemoSeed.PASSWORD, null); // 웹에서 로그인한 것처럼 refresh token 행을 만든다
        entityManager.flush();
        assertThat(seed.remove()).isTrue();

        assertThat(rowCounts()).isEqualTo(before);
        assertThat(seed.remove()).as("지울 데모 계정이 없다").isFalse();
    }

    @Test
    void 데모_장부에_다른_사용자가_있으면_아무것도_지우지_않는다() {
        seed.insert();
        fixtures.addMember(demoLedgerId(), fixtures.user(OTHER_EMAIL), LedgerRole.MEMBER);
        Map<String, Integer> before = rowCounts();

        assertThatThrownBy(seed::remove).isInstanceOf(IllegalStateException.class);
        assertThat(rowCounts()).isEqualTo(before);
    }

    @Test
    void 활성_프로파일에_다른_프로파일이_섞이면_넣지도_지우지도_않는다() {
        seed.insert();
        Map<String, Integer> before = rowCounts();

        environment.addActiveProfile("prod");
        assertThatThrownBy(seed::insert).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(seed::remove).isInstanceOf(IllegalStateException.class);
        assertThat(rowCounts()).isEqualTo(before);
    }

    private UUID demoLedgerId() {
        entityManager.flush();
        return jdbc.queryForObject("select m.ledger_id from ledger_member m join users u on u.id = m.user_id "
                + "where u.email = ? and m.role = 'OWNER'", UUID.class, DemoSeed.EMAIL);
    }

    private int count(String sql, Object... args) {
        entityManager.flush();
        return jdbc.queryForObject(sql, Integer.class, args);
    }

    /** 스키마의 모든 테이블(Flyway 기록 제외)의 행 수. */
    private Map<String, Integer> rowCounts() {
        entityManager.flush();
        return jdbc.queryForList("""
                        select table_name from information_schema.tables
                        where table_schema = current_schema() and table_type = 'BASE TABLE'
                          and table_name <> 'flyway_schema_history'
                        """, String.class).stream()
                .collect(Collectors.toMap(table -> table, table -> count("select count(*) from \"" + table + "\"")));
    }
}
