package app.accountbook.user;

import app.accountbook.category.CategoryService;
import app.accountbook.common.DuplicateEmailException;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.Names;
import app.accountbook.ledger.Ledger;
import app.accountbook.ledger.LedgerMember;
import app.accountbook.ledger.LedgerMemberRepository;
import app.accountbook.ledger.LedgerRepository;
import app.accountbook.ledger.LedgerRole;
import java.util.Locale;
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
     * 이메일은 앞뒤 공백을 지우고 소문자로 바꾼 값으로 저장하고 중복을 검사한다(P-101).
     * 같은 이메일로 동시에 가입하면 한 건만 성공하고 나머지는 {@link DuplicateEmailException}이다.
     * 표시 이름은 앞뒤 공백을 지운 1~{@value User#DISPLAY_NAME_MAX_LENGTH}자다(P-101).
     * 비밀번호는 NFKC로 맞춘 값으로 규칙({@link PasswordPolicy})을 보고 Argon2id 해시로만 저장한다.
     * 해시는 비싸므로 입력 검사와 중복 확인이 끝난 뒤에 한다(ADR 001 결정 7).
     * 해시와 그 자리를 기다리는 동안 DB 연결을 잡지 않도록 저장만 트랜잭션으로 한다. 이 메서드를 트랜잭션 안에서 부르지 않는다.
     */
    public User createUser(String rawEmail, String rawPassword, String rawDisplayName) {
        String email = normalizeEmail(rawEmail);
        String displayName = Names.normalize(rawDisplayName, User.DISPLAY_NAME_MAX_LENGTH);
        // 해시할 때도 같은 규칙을 본다. 여기서는 DB 조회와 해시보다 먼저 떨어뜨리려고 부른다.
        PasswordPolicy.normalizeAndValidate(rawPassword);
        if (userRepository.existsByEmail(email)) {
            throw new DuplicateEmailException();
        }
        String passwordHash = passwordHasher.hash(rawPassword);
        return transactionTemplate.execute(status ->
                saveWithPersonalLedger(User.of(email, passwordHash, displayName)));
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

    /**
     * 앞뒤 공백을 지우고 소문자로 바꾼 이메일을 돌려준다. 소문자화는 실행 환경의 로캘과 무관하다.
     * 형식은 앞뒤 공백을 지운 값이 ASCII 인쇄 가능 문자(U+0021~U+007E)뿐인지, {@code @}가 정확히 하나이고
     * 그 앞뒤가 비어 있지 않은지, {@value User#EMAIL_MAX_LENGTH}자 이하인지만 본다.
     * 아니면 {@link InvalidRequestException}. 통과한 값은 DB의 ck_users_email_normalized, ck_users_email_length도 지난다.
     */
    private static String normalizeEmail(String raw) {
        String stripped = raw == null ? "" : raw.strip();
        // 소문자로 바꾸기 전에 본다. 바꾼 뒤에 보면 켈빈 기호(U+212A)가 ASCII k가 되어 통과한다.
        if (!stripped.chars().allMatch(UserService::isPrintableAscii)) {
            throw invalidEmailFormat();
        }
        String email = stripped.toLowerCase(Locale.ROOT);
        int at = email.indexOf('@');
        if (at < 1 || at == email.length() - 1 || at != email.lastIndexOf('@')) {
            throw invalidEmailFormat();
        }
        if (email.length() > User.EMAIL_MAX_LENGTH) {
            throw new InvalidRequestException("이메일은 " + User.EMAIL_MAX_LENGTH + "자 이하여야 합니다.");
        }
        return email;
    }

    private static boolean isPrintableAscii(int ch) {
        return ch >= 0x21 && ch <= 0x7E;
    }

    private static InvalidRequestException invalidEmailFormat() {
        return new InvalidRequestException("이메일 형식이 올바르지 않습니다.");
    }
}
