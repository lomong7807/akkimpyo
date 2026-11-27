package app.accountbook.user;

import app.accountbook.category.CategoryService;
import app.accountbook.common.DuplicateEmailException;
import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.Names;
import app.accountbook.common.NotFoundException;
import app.accountbook.ledger.Ledger;
import app.accountbook.ledger.LedgerMember;
import app.accountbook.ledger.LedgerMemberRepository;
import app.accountbook.ledger.LedgerRepository;
import app.accountbook.ledger.LedgerRole;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;
import org.hibernate.exception.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class UserService {

    /** V1의 이름 없는 UNIQUE (email)에 PostgreSQL이 붙인 제약 이름. */
    private static final String EMAIL_UNIQUE_CONSTRAINT = "users_email_key";

    private static final String LOGIN_FAILED = "로그인 실패: {}";
    private static final String UNKNOWN_ACCOUNT = "알 수 없는 계정";

    private static final Logger log = LoggerFactory.getLogger(UserService.class);

    private final UserRepository userRepository;
    private final LedgerRepository ledgerRepository;
    private final LedgerMemberRepository memberRepository;
    private final CategoryService categoryService;
    private final PasswordHasher passwordHasher;
    private final TransactionTemplate transactionTemplate;
    private final SignupAllowlist allowlist;
    /** 비교할 저장값이 없을 때 대신 비교하는 값. 저장하는 값과 같은 방식으로 만들고, 맞다고 나와도 쓰지 않는다. */
    private final String decoyHash;

    UserService(UserRepository userRepository, LedgerRepository ledgerRepository,
                LedgerMemberRepository memberRepository, CategoryService categoryService,
                PasswordHasher passwordHasher, TransactionTemplate transactionTemplate, SignupAllowlist allowlist) {
        this.userRepository = userRepository;
        this.ledgerRepository = ledgerRepository;
        this.memberRepository = memberRepository;
        this.categoryService = categoryService;
        this.passwordHasher = passwordHasher;
        this.transactionTemplate = transactionTemplate;
        this.allowlist = allowlist;
        this.decoyHash = passwordHasher.hash("decoy1" + UUID.randomUUID());
    }

    /**
     * 사용자와 개인 장부({@code 내 가계부}, Asia/Seoul), OWNER 구성원,
     * 기본 카테고리(P-223: 지출 11개, 수입 4개, 지출과 수입의 {@code 미분류})를 한 트랜잭션으로 만든다.
     * 중간에 실패하면 아무것도 남지 않는다(F-002).
     * 이메일은 맞춘 값({@link EmailNormalizer})으로 저장하고 중복을 검사한다(P-101).
     * 같은 이메일로 동시에 가입하면 한 건만 성공하고 나머지는 {@link DuplicateEmailException}이다.
     * 표시 이름은 P-214의 글자 규칙({@link Names})으로 맞춘 1~{@value User#DISPLAY_NAME_MAX_LENGTH}자다(P-101).
     * 비밀번호는 NFKC로 맞춘 값으로 규칙({@link PasswordPolicy})을 보고 Argon2id 해시로만 저장한다.
     * 형식 오류는 모두 모아 알리고(#29), 형식이 모두 맞을 때만 허용 목록({@link SignupAllowlist}, P-102)과 중복을 차례로 본다.
     * 해시는 비싸므로 입력 검사와 중복 확인이 끝난 뒤에 한다(ADR 001 결정 7).
     * 해시와 그 자리를 기다리는 동안 DB 연결을 잡지 않도록 저장만 트랜잭션으로 한다. 이 메서드를 트랜잭션 안에서 부르지 않는다.
     */
    public User createUser(String rawEmail, String rawPassword, String rawDisplayName) {
        List<InvalidRequestException> errors = new ArrayList<>();
        String email = checked(errors, () -> EmailNormalizer.normalize(rawEmail));
        // 해시할 때도 같은 규칙을 본다. 여기서는 DB 조회와 해시보다 먼저 떨어뜨리려고 부른다.
        checked(errors, () -> PasswordPolicy.normalizeAndValidate(rawPassword));
        String displayName = checked(errors,
                () -> Names.normalize(rawDisplayName, User.DISPLAY_NAME_MAX_LENGTH, "displayName"));
        if (!errors.isEmpty()) {
            throw InvalidRequestException.ofAll(errors);
        }
        if (!allowlist.allows(email)) {
            throw new InvalidRequestException("email", FieldErrorCode.NOT_ALLOWED, "가입이 허용된 이메일이 아닙니다.");
        }
        if (userRepository.existsByEmail(email)) {
            throw new DuplicateEmailException();
        }
        String passwordHash = passwordHasher.hash(rawPassword);
        User user = transactionTemplate.execute(status ->
                saveWithPersonalLedger(User.of(email, passwordHash, displayName)));
        log.info("가입: 사용자 {}", user.getId());
        return user;
    }

    /**
     * 로그인의 확인(F-009). 이메일과 비밀번호가 맞으면 사용자 id이고, 아니면 이유를 나누지 않고 빈 값이다(P-105).
     * 이메일은 가입과 같은 방식({@link EmailNormalizer})으로, 비밀번호는 NFKC로 맞춰 비교한다.
     * 걸린 시간으로 가입 여부가 드러나지 않게, 맞는 사용자가 없거나 저장값이 비교할 수 없는 모양이어도 가짜 저장값과 비교한다(ADR 001 결정 7).
     * 비교할 수 없는 비밀번호({@link PasswordPolicy#isComparable})는 비교하지 않으므로, 가려 줄 비교가 없는 조회도 하지 않는다.
     * 비교와 그 자리를 기다리는 동안 DB 연결을 잡지 않도록 이 메서드를 트랜잭션 안에서 부르지 않는다.
     * 자리가 나지 않으면 {@link PasswordHashBusyException}이다.
     *
     * <p>실패는 사용자 id로 남긴다. 찾은 사용자가 없으면 알 수 없는 계정이고 입력한 값은 남기지 않는다(ADR 001 결정 10).
     */
    public Optional<UUID> authenticate(String rawEmail, String rawPassword) {
        if (!PasswordPolicy.isComparable(rawPassword)) {
            log.info(LOGIN_FAILED, UNKNOWN_ACCOUNT);
            return Optional.empty();
        }
        Optional<User> found = findByEmail(rawEmail);
        Optional<User> comparable = found.filter(user -> StoredPasswordHash.isComparable(user.getPasswordHash()));
        boolean matches = passwordHasher.matches(rawPassword,
                comparable.map(User::getPasswordHash).orElse(decoyHash));
        Optional<UUID> userId = comparable.filter(user -> matches).map(User::getId);
        if (userId.isEmpty()) {
            log.info(LOGIN_FAILED, found.map(user -> "사용자 " + user.getId()).orElse(UNKNOWN_ACCOUNT));
        }
        return userId;
    }

    /** 이 id의 사용자가 있는가. 토큰의 사용자가 탈퇴로 지워졌는지 요청마다 본다(ADR 001 결정 1). 사용자의 값은 내주지 않는다. */
    public boolean exists(UUID userId) {
        return userRepository.existsById(userId);
    }

    /**
     * 호출자 자신의 이메일과 표시 이름(#30, F-014). 다른 사용자의 값을 고를 인자는 없다.
     * 토큰을 확인한 뒤 그 사이에 사용자가 지워졌으면 {@link NotFoundException}이다.
     */
    public UserProfile profile(UUID actorId) {
        return userRepository.findById(actorId).map(UserProfile::of).orElseThrow(NotFoundException::new);
    }

    /** 규칙에 맞으면 맞춘 값, 아니면 오류를 모으고 null. */
    private static String checked(List<InvalidRequestException> errors, Supplier<String> rule) {
        try {
            return rule.get();
        } catch (InvalidRequestException e) {
            errors.add(e);
            return null;
        }
    }

    /** 형식이 틀린 이메일로 가입한 사람은 없다. */
    private Optional<User> findByEmail(String rawEmail) {
        String email;
        try {
            email = EmailNormalizer.normalize(rawEmail);
        } catch (InvalidRequestException e) {
            return Optional.empty();
        }
        return userRepository.findByEmail(email);
    }

    private User saveWithPersonalLedger(User newUser) {
        User user = saveUnlessDuplicate(newUser);
        Ledger ledger = ledgerRepository.save(Ledger.personal());
        memberRepository.save(LedgerMember.of(ledger.getId(), user.getId(), LedgerRole.OWNER));
        categoryService.createDefaults(user.getId(), ledger.getId());
        return user;
    }

    /**
     * 바로 flush해서 DB 제약 위반을 이 메서드 안에서 받는다.
     * 중복 확인과 저장 사이(해시하는 동안)에 같은 이메일이 들어오면 나중 것이 유니크 제약에 걸리는데, 그것도 같은 이메일 오류로 알린다.
     */
    private User saveUnlessDuplicate(User user) {
        try {
            return userRepository.saveAndFlush(user);
        } catch (DataIntegrityViolationException e) {
            if (e.getCause() instanceof ConstraintViolationException violation
                    && EMAIL_UNIQUE_CONSTRAINT.equals(violation.getConstraintName())) {
                throw new DuplicateEmailException();
            }
            throw e;
        }
    }
}
