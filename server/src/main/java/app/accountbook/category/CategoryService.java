package app.accountbook.category;

import app.accountbook.common.InUseException;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.Names;
import app.accountbook.common.NotLedgerMemberException;
import app.accountbook.ledger.LedgerAccess;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CategoryService {

    private final CategoryRepository categoryRepository;
    private final CategoryUsage categoryUsage;
    private final LedgerAccess ledgerAccess;

    CategoryService(CategoryRepository categoryRepository, CategoryUsage categoryUsage,
                    LedgerAccess ledgerAccess) {
        this.categoryRepository = categoryRepository;
        this.categoryUsage = categoryUsage;
        this.ledgerAccess = ledgerAccess;
    }

    /** 카테고리는 2단계까지다. 부모는 같은 장부·같은 kind의 최상위 분류여야 한다. */
    @Transactional
    public Category create(UUID actorId, UUID ledgerId, CategoryCommand cmd) {
        ledgerAccess.requireMember(actorId, ledgerId);
        if (cmd == null) {
            throw new InvalidRequestException("카테고리 정보가 없습니다.");
        }
        if (cmd.kind() == null) {
            throw new InvalidRequestException("수입·지출 구분이 없습니다.");
        }
        String name = Names.normalize(cmd.name());
        if (cmd.parentId() != null) {
            requireValidParent(ledgerId, cmd.kind(), cmd.parentId());
        }
        return categoryRepository.save(Category.of(ledgerId, cmd.kind(), name, cmd.parentId()));
    }

    @Transactional
    public Category rename(UUID actorId, UUID categoryId, String name) {
        Category category = loadForMember(actorId, categoryId);
        requireNotSystem(category);
        category.rename(Names.normalize(name));
        return category;
    }

    /** 기본 카테고리, 하위 분류가 있는 카테고리, 라인이 참조하는 카테고리(소프트 삭제된 거래 포함)는 지울 수 없다. */
    @Transactional
    public void delete(UUID actorId, UUID categoryId) {
        Category category = loadForMember(actorId, categoryId);
        requireNotSystem(category);
        if (categoryRepository.existsByParentId(categoryId)) {
            throw new InUseException("하위 분류가 있는 카테고리는 지울 수 없습니다.");
        }
        if (categoryUsage.isUsed(categoryId)) {
            throw new InUseException("거래가 있는 카테고리는 지울 수 없습니다.");
        }
        categoryRepository.delete(category);
    }

    @Transactional(readOnly = true)
    public List<Category> list(UUID actorId, UUID ledgerId) {
        ledgerAccess.requireMember(actorId, ledgerId);
        return categoryRepository.findByLedgerIdOrderByCreatedAtAsc(ledgerId);
    }

    /** 그 장부의 {@code 미분류}. 가입 시 kind마다 하나씩 만들어지므로 없으면 데이터 이상이다. */
    @Transactional(readOnly = true)
    public Category uncategorized(UUID ledgerId, CategoryKind kind) {
        return categoryRepository.findByLedgerIdAndKindAndSystemTrue(ledgerId, kind)
                .orElseThrow(() -> new IllegalStateException(
                        "장부 " + ledgerId + "에 " + kind + " 미분류 카테고리가 없습니다."));
    }

    private void requireValidParent(UUID ledgerId, CategoryKind kind, UUID parentId) {
        Category parent = categoryRepository.findById(parentId)
                .filter(candidate -> candidate.getLedgerId().equals(ledgerId))
                .orElseThrow(() -> new InvalidRequestException("상위 분류를 찾을 수 없습니다."));
        if (!parent.isTopLevel()) {
            throw new InvalidRequestException("카테고리는 2단계까지만 만들 수 있습니다.");
        }
        if (parent.getKind() != kind) {
            throw new InvalidRequestException("상위 분류와 수입·지출 구분이 같아야 합니다.");
        }
    }

    private static void requireNotSystem(Category category) {
        if (category.isSystem()) {
            throw new InvalidRequestException("기본 카테고리(미분류)는 바꾸거나 지울 수 없습니다.");
        }
    }

    /** 없는 카테고리도 구성원이 아닌 것과 같은 예외로 알려 다른 장부 카테고리의 존재를 드러내지 않는다. */
    private Category loadForMember(UUID actorId, UUID categoryId) {
        Category category = categoryRepository.findById(categoryId).orElseThrow(NotLedgerMemberException::new);
        ledgerAccess.requireMember(actorId, category.getLedgerId());
        return category;
    }
}
