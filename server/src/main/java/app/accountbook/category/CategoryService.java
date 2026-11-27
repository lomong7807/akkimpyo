package app.accountbook.category;

import app.accountbook.common.DuplicateCategoryNameException;
import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InUseException;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.Names;
import app.accountbook.common.NotLedgerMemberException;
import app.accountbook.common.Times;
import app.accountbook.ledger.LedgerAccess;
import java.util.List;
import java.util.UUID;
import org.hibernate.exception.ConstraintViolationException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CategoryService {

    /** V2 마이그레이션의 유니크 제약 이름. */
    private static final String NAME_UNIQUE_CONSTRAINT = "uq_category_name";

    private final CategoryRepository categoryRepository;
    private final CategoryUsage categoryUsage;
    private final LedgerAccess ledgerAccess;

    CategoryService(CategoryRepository categoryRepository, CategoryUsage categoryUsage,
                    LedgerAccess ledgerAccess) {
        this.categoryRepository = categoryRepository;
        this.categoryUsage = categoryUsage;
        this.ledgerAccess = ledgerAccess;
    }

    /**
     * 새 장부에 기본 카테고리(P-223: 지출 11개, 수입 4개, 지출과 수입의 미분류)를 명세 순서대로 넣는다.
     * 장부를 만든 소유자가 같은 트랜잭션에서 부른다. 이미 기본 카테고리가 있는 장부에 다시 부르면
     * DB 유일 제약(uq_category_system, uq_category_name)에 걸려 실패한다.
     */
    @Transactional
    public List<Category> createDefaults(UUID actorId, UUID ledgerId) {
        ledgerAccess.requireOwner(actorId, ledgerId);
        return categoryRepository.saveAllAndFlush(DefaultCategories.forLedger(ledgerId, Times.now()));
    }

    /**
     * 카테고리는 2단계까지다. 부모는 같은 장부·같은 kind의 최상위 분류여야 한다.
     * 이름은 앞뒤 공백을 지운 1~20자이고 같은 상위 아래에서 겹칠 수 없다(P-221).
     */
    @Transactional
    public Category create(UUID actorId, UUID ledgerId, CategoryCommand cmd) {
        ledgerAccess.requireMember(actorId, ledgerId);
        if (cmd == null) {
            throw new InvalidRequestException(InvalidRequestException.WHOLE_BODY, FieldErrorCode.REQUIRED,
                    "카테고리 정보가 없습니다.");
        }
        if (cmd.kind() == null) {
            throw new InvalidRequestException("kind", FieldErrorCode.REQUIRED, "수입·지출 구분이 없습니다.");
        }
        String name = Names.normalize(cmd.name(), Category.NAME_MAX_LENGTH);
        if (cmd.parentId() != null) {
            requireValidParent(ledgerId, cmd.kind(), cmd.parentId());
        }
        Category category = Category.of(ledgerId, cmd.kind(), name, cmd.parentId());
        requireUniqueName(category, name);
        return saveUnlessDuplicate(category);
    }

    @Transactional
    public Category rename(UUID actorId, UUID categoryId, String name) {
        Category category = loadForMember(actorId, categoryId);
        requireNotSystem(category);
        String newName = Names.normalize(name, Category.NAME_MAX_LENGTH);
        requireUniqueName(category, newName);
        category.rename(newName);
        return saveUnlessDuplicate(category);
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

    /**
     * 장부의 모든 카테고리(최상위와 하위, 지출과 수입). 미분류(system)가 뒤, 다음은 만든 시각, 같으면 id 순이다.
     * 그래서 구분별로 보면 미분류가 맨 뒤다(F-509, dba 메모 PR #136). 조회는 한 번이다.
     */
    @Transactional(readOnly = true)
    public List<Category> list(UUID actorId, UUID ledgerId) {
        ledgerAccess.requireMember(actorId, ledgerId);
        return categoryRepository.findByLedgerIdOrderBySystemAscCreatedAtAscIdAsc(ledgerId);
    }

    /** 그 장부의 {@code 미분류}. 장부를 만들 때 kind마다 하나씩 만들어지므로 없으면 데이터 이상이다. */
    @Transactional(readOnly = true)
    public Category uncategorized(UUID ledgerId, CategoryKind kind) {
        return categoryRepository.findByLedgerIdAndKindAndSystemTrue(ledgerId, kind)
                .orElseThrow(() -> new IllegalStateException(
                        "장부 " + ledgerId + "에 " + kind + " 미분류 카테고리가 없습니다."));
    }

    private void requireValidParent(UUID ledgerId, CategoryKind kind, UUID parentId) {
        Category parent = categoryRepository.findById(parentId)
                .filter(candidate -> candidate.getLedgerId().equals(ledgerId))
                .orElseThrow(() -> new InvalidRequestException("parentId", FieldErrorCode.NOT_FOUND,
                        "상위 분류를 찾을 수 없습니다."));
        if (!parent.isTopLevel()) {
            throw new InvalidRequestException("parentId", FieldErrorCode.NOT_ALLOWED, "카테고리는 2단계까지만 만들 수 있습니다.");
        }
        if (parent.getKind() != kind) {
            throw new InvalidRequestException("parentId", FieldErrorCode.NOT_ALLOWED,
                    "상위 분류와 수입·지출 구분이 같아야 합니다.");
        }
    }

    /** 자기 자신과는 겹치지 않는 것으로 본다. 이름은 글자 그대로 비교한다(대소문자, 가운데 공백 구분). */
    private void requireUniqueName(Category category, String name) {
        if (categoryRepository.existsSibling(category.getLedgerId(), category.getKind(), category.getParentId(),
                name, category.getId())) {
            throw new DuplicateCategoryNameException();
        }
    }

    /**
     * 바로 flush해서 DB 제약 위반을 이 메서드 안에서 받는다.
     * 동시 요청이 둘 다 앱 검사를 통과하면 나중 것이 유니크 제약에 걸리는데, 그것도 같은 이름 오류로 알린다.
     */
    private Category saveUnlessDuplicate(Category category) {
        try {
            return categoryRepository.saveAndFlush(category);
        } catch (DataIntegrityViolationException e) {
            if (e.getCause() instanceof ConstraintViolationException violation
                    && NAME_UNIQUE_CONSTRAINT.equals(violation.getConstraintName())) {
                throw new DuplicateCategoryNameException();
            }
            throw e;
        }
    }

    /** 어느 입력란의 잘못도 아니어서 본문 전체의 오류로 알린다. 지금까지와 같은 응답이다. */
    private static void requireNotSystem(Category category) {
        if (category.isSystem()) {
            throw new InvalidRequestException(InvalidRequestException.WHOLE_BODY, FieldErrorCode.NOT_ALLOWED,
                    "기본 카테고리(미분류)는 바꾸거나 지울 수 없습니다.");
        }
    }

    /** 없는 카테고리도 구성원이 아닌 것과 같은 예외로 알려 다른 장부 카테고리의 존재를 드러내지 않는다. */
    private Category loadForMember(UUID actorId, UUID categoryId) {
        Category category = categoryRepository.findById(categoryId).orElseThrow(NotLedgerMemberException::new);
        ledgerAccess.requireMember(actorId, category.getLedgerId());
        return category;
    }
}
