package app.accountbook.user;

import app.accountbook.category.Category;
import app.accountbook.category.CategoryKind;
import app.accountbook.category.CategoryRepository;
import app.accountbook.common.DuplicateEmailException;
import app.accountbook.ledger.Ledger;
import app.accountbook.ledger.LedgerMember;
import app.accountbook.ledger.LedgerMemberRepository;
import app.accountbook.ledger.LedgerRepository;
import app.accountbook.ledger.LedgerRole;
import java.util.Arrays;
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
     */
    @Transactional
    public User createUser(String email, String passwordHash, String displayName) {
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
}
