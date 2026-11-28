package app.accountbook.demo;

import app.accountbook.account.AccountCommand;
import app.accountbook.account.AccountService;
import app.accountbook.category.Category;
import app.accountbook.category.CategoryKind;
import app.accountbook.category.CategoryService;
import app.accountbook.common.DuplicateEmailException;
import app.accountbook.demo.DemoSamples.DemoAccount;
import app.accountbook.demo.DemoSamples.Sample;
import app.accountbook.ledger.LedgerDates;
import app.accountbook.ledger.LedgerService;
import app.accountbook.transaction.TransactionCommand;
import app.accountbook.transaction.TransactionService;
import app.accountbook.transaction.TransactionType;
import app.accountbook.user.UserService;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 로컬 확인용 데모 계정과 예시 데이터를 넣고 지운다(#349, docs/dev/demo-seed.md). 빈은 local 프로파일에서만 생기고(운영은
 * 프로파일이 없다), 쓰기 직전에 활성 프로파일과 실제로 붙은 DB의 호스트를 다시 본다. 넣기는 가입·계좌·거래 서비스를 거쳐
 * 입력 규칙과 가입 허용 목록을 그대로 지난다. 지우기는 서비스가 없어 SQL로 한다.
 */
@Component
@Profile(DemoSeed.PROFILE)
class DemoSeed implements ApplicationRunner {

    static final String PROFILE = "local";
    static final Set<String> ALLOWED_PROFILES = Set.of(PROFILE); // 미리보기 프로파일은 아직 없다.
    // 이 컴퓨터의 DB. compose의 서비스 이름(db)은 운영 DB_URL의 호스트와 같아 넣지 않는다.
    static final Set<String> LOCAL_DB_HOSTS = Set.of("localhost", "127.0.0.1", "::1");
    private static final Pattern JDBC_URL = Pattern.compile("jdbc:postgresql://([^/?]+)[^?]*(\\?.*)?");
    static final String MODE = "demo.seed";
    static final String EMAIL = "demo@example.com";
    static final String PASSWORD = "demo1234pw"; // 로컬 전용 값이라 문서에 적는다.
    private static final ZoneId LEDGER_ZONE = ZoneId.of("Asia/Seoul"); // 가입이 만드는 개인 장부의 시간대

    /** FK 순서다. 거래의 라인은 ON DELETE CASCADE로 같이 지워진다. */
    private static final List<String> DELETES = List.of(
            "delete from change_log where ledger_id in (:ledgers)",
            "delete from transaction where ledger_id in (:ledgers)",
            "delete from category where ledger_id in (:ledgers)",
            "delete from account where ledger_id in (:ledgers)",
            "delete from ledger_member where ledger_id in (:ledgers)",
            "delete from ledger where id in (:ledgers)",
            "delete from refresh_token where family_id in (select id from refresh_token_family where user_id = :user)",
            "delete from refresh_token_family where user_id = :user",
            "delete from users where id = :user");

    private static final Logger log = LoggerFactory.getLogger(DemoSeed.class);

    private final UserService userService;
    private final LedgerService ledgerService;
    private final AccountService accountService;
    private final CategoryService categoryService;
    private final TransactionService transactionService;
    private final NamedParameterJdbcTemplate jdbc;
    private final TransactionTemplate transactionTemplate;
    private final ApplicationContext context;
    private final Clock clock;

    DemoSeed(UserService userService, LedgerService ledgerService, AccountService accountService,
             CategoryService categoryService, TransactionService transactionService, JdbcTemplate jdbcTemplate,
             TransactionTemplate transactionTemplate, ApplicationContext context, Clock clock) {
        this.userService = userService;
        this.ledgerService = ledgerService;
        this.accountService = accountService;
        this.categoryService = categoryService;
        this.transactionService = transactionService;
        this.jdbc = new NamedParameterJdbcTemplate(jdbcTemplate);
        this.transactionTemplate = transactionTemplate;
        this.context = context;
        this.clock = clock;
    }

    /** {@value #MODE}가 있으면 기동 뒤 넣거나 지우고 앱을 끝낸다. 실패하면 기동 실패가 되어 0이 아닌 코드로 끝난다. */
    @Override
    public void run(ApplicationArguments args) {
        switch (context.getEnvironment().getProperty(MODE)) {
            case null -> {
                return;
            }
            case "insert" -> insert();
            case "remove" -> remove();
            default -> throw new IllegalStateException(MODE + "에는 insert나 remove를 준다.");
        }
        System.exit(SpringApplication.exit(context));
    }

    /** 활성 프로파일이 하나 이상이고 모두 {@link #ALLOWED_PROFILES}에 있어야 한다. */
    static void requireAllowedProfiles(String... activeProfiles) {
        if (activeProfiles.length == 0 || !ALLOWED_PROFILES.containsAll(List.of(activeProfiles))) {
            throw new IllegalStateException("데모 데이터는 local 프로파일에서만 넣고 지운다. 활성 프로파일: ["
                    + String.join(",", activeProfiles) + "]");
        }
    }

    /**
     * 접속 주소(jdbc:postgresql://호스트[:포트][,…]/…)의 호스트가 모두 {@link #LOCAL_DB_HOSTS}여야 한다. 다른 모양이거나 주소
     * 뒤의 설정으로 호스트를 바꾸면(PGHOST) 거부한다. 문구에 주소를 넣지 않는다(비밀번호가 들 수 있다).
     */
    static void requireLocalDatabase(String jdbcUrl) {
        Matcher url = JDBC_URL.matcher(String.valueOf(jdbcUrl));
        if (!url.matches() || String.valueOf(url.group(2)).toUpperCase(Locale.ROOT).contains("PGHOST")
                || !Arrays.stream(url.group(1).split(",", -1)).allMatch(host -> LOCAL_DB_HOSTS.contains(
                        host.replaceFirst(":\\d+$", "").replaceAll("^\\[|]$", "").toLowerCase(Locale.ROOT)))) {
            throw new IllegalStateException("데모 데이터는 이 컴퓨터의 DB(" + LOCAL_DB_HOSTS + ")에만 넣고 지운다. DB_URL을 확인한다.");
        }
    }

    private void requireLocalTarget() {
        requireAllowedProfiles(context.getEnvironment().getActiveProfiles());
        requireLocalDatabase(jdbc.getJdbcTemplate().execute(
                (ConnectionCallback<String>) connection -> connection.getMetaData().getURL()));
    }

    /** 데모 계정, 계좌, 거래를 넣고 참이다. 이미 있으면 아무것도 바꾸지 않고 거짓이다. 트랜잭션 안에서 부르지 않는다. */
    boolean insert() {
        requireLocalTarget();
        UUID actorId;
        try {
            actorId = userService.createUser(EMAIL, PASSWORD, "데모").getId();
        } catch (DuplicateEmailException e) {
            log.info("데모 계정 {}이 이미 있어 넣지 않는다. 다시 넣으려면 먼저 지운다.", EMAIL);
            return false;
        }
        UUID ledgerId = ledgerService.memberships(actorId).getFirst().ledgerId();
        LocalDate today = LedgerDates.today(clock, LEDGER_ZONE);
        Map<DemoAccount, UUID> accounts = new HashMap<>();
        for (DemoAccount account : DemoSamples.ACCOUNTS) {
            accounts.put(account, accountService.create(actorId, ledgerId, new AccountCommand(account.label(),
                    account.type(), account.openingBalance(), DemoSamples.openingDate(today))).getId());
        }
        Map<String, UUID> categories = categoryService.list(actorId, ledgerId).stream()
                .collect(Collectors.toMap(category -> key(category.getKind(), category.getName()), Category::getId));
        DemoSamples.SAMPLES.forEach(sample -> transactionService.create(actorId, ledgerId,
                command(sample, today, accounts, categories), null));
        log.info("데모 계정 {}을 넣었다: 계좌 {}개, 거래 {}건", EMAIL, accounts.size(), DemoSamples.SAMPLES.size());
        return true;
    }

    /** 데모 계정과 그 장부의 행을 한 트랜잭션으로 지우고 참, 없으면 거짓이다. 장부에 다른 사용자가 있거나 FK에 걸리면 실패한다. */
    boolean remove() {
        requireLocalTarget();
        boolean removed = Boolean.TRUE.equals(transactionTemplate.execute(status -> deleteDemoRows()));
        log.info(removed ? "데모 계정 {}과 그 장부의 데이터를 지웠다." : "지울 데모 계정 {}이 없다.", EMAIL);
        return removed;
    }

    private boolean deleteDemoRows() {
        List<UUID> users = jdbc.queryForList("select id from users where email = :email",
                Map.of("email", EMAIL), UUID.class);
        if (users.isEmpty()) {
            return false;
        }
        MapSqlParameterSource params = new MapSqlParameterSource("user", users.getFirst());
        params.addValue("ledgers", jdbc.queryForList("select ledger_id from ledger_member where user_id = :user",
                params, UUID.class));
        if (jdbc.queryForObject("select count(*) from ledger_member where ledger_id in (:ledgers) and user_id <> :user",
                params, Integer.class) != 0) {
            throw new IllegalStateException("데모 계정의 장부에 다른 사용자가 있어 아무것도 지우지 않는다.");
        }
        DELETES.forEach(sql -> jdbc.update(sql, params));
        return true;
    }

    private static TransactionCommand command(Sample sample, LocalDate today, Map<DemoAccount, UUID> accounts,
                                              Map<String, UUID> categories) {
        UUID account = accounts.get(sample.account());
        if (sample.type() == TransactionType.TRANSFER) {
            return new TransactionCommand.Transfer(UUID.randomUUID(), sample.date(today), null, account,
                    accounts.get(sample.toAccount()), sample.amount(), sample.text());
        }
        CategoryKind kind = sample.type() == TransactionType.INCOME ? CategoryKind.INCOME : CategoryKind.EXPENSE;
        UUID category = Objects.requireNonNull(categories.get(key(kind, sample.category())),
                () -> "기본 카테고리에 없는 이름: " + kind + " " + sample.category());
        return new TransactionCommand.Entry(UUID.randomUUID(), sample.type(), sample.date(today), null, account,
                category, sample.amount(), null, sample.text(), null, null);
    }

    private static String key(CategoryKind kind, String name) {
        return kind + "/" + name;
    }
}
