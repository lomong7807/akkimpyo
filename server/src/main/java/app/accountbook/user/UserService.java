package app.accountbook.user;

import app.accountbook.category.CategoryService;
import app.accountbook.common.DuplicateEmailException;
import app.accountbook.common.Names;
import app.accountbook.ledger.Ledger;
import app.accountbook.ledger.LedgerMember;
import app.accountbook.ledger.LedgerMemberRepository;
import app.accountbook.ledger.LedgerRepository;
import app.accountbook.ledger.LedgerRole;
import java.util.UUID;
import org.hibernate.exception.ConstraintViolationException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class UserService {

    /** V1의 이름 없는 UNIQUE (email)에 PostgreSQL이 붙인 제약 이름. */
    private static final String EMAIL_UNIQUE_CONSTRAINT = "users_email_key";

    private final UserRepository userRepository;
    private final LedgerRepository ledgerRepository;
    private final LedgerMemberRepository memberRepository;
    private final CategoryService categoryService;
    private final PasswordHasher passwordHasher;
    private final TransactionTemplate transactionTemplate;

    UserService(UserRepository userRepository, LedgerRepository ledgerRepository,
                LedgerMemberRepository memberRepository, CategoryService categoryService,
                PasswordHasher passwordHasher, TransactionTemplate transactionTemplate) {
        this.userRepository = userRepository;
        this.ledgerRepository = ledgerRepository;
        this.memberRepository = memberRepository;
        this.categoryService = categoryService;
        this.passwordHasher = passwordHasher;
        this.transactionTemplate = transactionTemplate;
    }

    /**
     * 사용자와 개인 장부({@code 내 가계부}, Asia/Seoul), OWNER 구성원,
     * 기본 카테고리(P-223: 지출 11개, 수입 4개, 지출과 수입의 {@code 미분류})를 한 트랜잭션으로 만든다.
     * 중간에 실패하면 아무것도 남지 않는다(F-002).
     * 이메일은 맞춘 값({@link EmailNormalizer})으로 저장하고 중복을 검사한다(P-101).
     * 같은 이메일로 동시에 가입하면 한 건만 성공하고 나머지는 {@link DuplicateEmailException}이다.
     * 표시 이름은 P-214의 글자 규칙({@link Names})으로 맞춘 1~{@value User#DISPLAY_NAME_MAX_LENGTH}자다(P-101).
     * 비밀번호는 NFKC로 맞춘 값으로 규칙({@link PasswordPolicy})을 보고 Argon2id 해시로만 저장한다.
     * 해시는 비싸므로 입력 검사와 중복 확인이 끝난 뒤에 한다(ADR 001 결정 7).
     * 해시와 그 자리를 기다리는 동안 DB 연결을 잡지 않도록 저장만 트랜잭션으로 한다. 이 메서드를 트랜잭션 안에서 부르지 않는다.
     */
    public User createUser(String rawEmail, String rawPassword, String rawDisplayName) {
        String email = EmailNormalizer.normalize(rawEmail);
        String displayName = Names.normalize(rawDisplayName, User.DISPLAY_NAME_MAX_LENGTH, "displayName");
        // 해시할 때도 같은 규칙을 본다. 여기서는 DB 조회와 해시보다 먼저 떨어뜨리려고 부른다.
        PasswordPolicy.normalizeAndValidate(rawPassword);
        if (userRepository.existsByEmail(email)) {
            throw new DuplicateEmailException();
        }
        String passwordHash = passwordHasher.hash(rawPassword);
        return transactionTemplate.execute(status ->
                saveWithPersonalLedger(User.of(email, passwordHash, displayName)));
    }

    /** 이 id의 사용자가 있는가. 토큰의 사용자가 탈퇴로 지워졌는지 요청마다 본다(ADR 001 결정 1). 사용자의 값은 내주지 않는다. */
    public boolean exists(UUID userId) {
        return userRepository.existsById(userId);
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
