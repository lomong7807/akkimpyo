package app.accountbook.user;

import app.accountbook.category.Category;
import app.accountbook.category.CategoryKind;
import app.accountbook.category.CategoryRepository;
import app.accountbook.common.DuplicateEmailException;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.Names;
import app.accountbook.ledger.Ledger;
import app.accountbook.ledger.LedgerMember;
import app.accountbook.ledger.LedgerMemberRepository;
import app.accountbook.ledger.LedgerRepository;
import app.accountbook.ledger.LedgerRole;
import java.util.Arrays;
import java.util.Locale;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UserService {

    private final UserRepository userRepository;
    private final LedgerRepository ledgerRepository;
    private final LedgerMemberRepository memberRepository;
    private final CategoryRepository categoryRepository;

    UserService(UserRepository userRepository, LedgerRepository ledgerRepository,
                LedgerMemberRepository memberRepository, CategoryRepository categoryRepository) {
        this.userRepository = userRepository;
        this.ledgerRepository = ledgerRepository;
        this.memberRepository = memberRepository;
        this.categoryRepository = categoryRepository;
    }

    /**
     * 사용자와 개인 장부({@code 내 가계부}, Asia/Seoul), OWNER 구성원,
     * 수입·지출 {@code 미분류} 기본 카테고리를 한 트랜잭션으로 만든다.
     * 이메일은 앞뒤 공백을 지우고 소문자로 바꾼 값으로 저장하고 중복을 검사한다(P-101).
     * 표시 이름은 앞뒤 공백을 지운 1~{@value User#DISPLAY_NAME_MAX_LENGTH}자다(P-101).
     */
    @Transactional
    public User createUser(String rawEmail, String passwordHash, String rawDisplayName) {
        String email = normalizeEmail(rawEmail);
        String displayName = Names.normalize(rawDisplayName, User.DISPLAY_NAME_MAX_LENGTH);
        if (userRepository.existsByEmail(email)) {
            throw new DuplicateEmailException();
        }
        User user = userRepository.save(User.of(email, passwordHash, displayName));
        Ledger ledger = ledgerRepository.save(Ledger.personal());
        memberRepository.save(LedgerMember.of(ledger.getId(), user.getId(), LedgerRole.OWNER));
        categoryRepository.saveAll(Arrays.stream(CategoryKind.values())
                .map(kind -> Category.uncategorized(ledger.getId(), kind))
                .toList());
        return user;
    }

    /**
     * 앞뒤 공백을 지우고 소문자로 바꾼 이메일을 돌려준다. 소문자화는 실행 환경의 로캘과 무관하다.
     * 형식은 {@code @}가 정확히 하나이고 그 앞뒤가 비어 있지 않은지와, 정규화한 값이
     * {@value User#EMAIL_MAX_LENGTH}자(유니코드 글자 수, DB 컬럼과 같은 기준) 이하인지만 본다.
     * 아니면 {@link InvalidRequestException}.
     */
    private static String normalizeEmail(String raw) {
        String email = raw == null ? "" : raw.strip().toLowerCase(Locale.ROOT);
        int at = email.indexOf('@');
        if (at < 1 || at == email.length() - 1 || at != email.lastIndexOf('@')) {
            throw new InvalidRequestException("이메일 형식이 올바르지 않습니다.");
        }
        if (email.codePointCount(0, email.length()) > User.EMAIL_MAX_LENGTH) {
            throw new InvalidRequestException("이메일은 " + User.EMAIL_MAX_LENGTH + "자 이하여야 합니다.");
        }
        return email;
    }
}
