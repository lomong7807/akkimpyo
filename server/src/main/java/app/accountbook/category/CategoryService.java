package app.accountbook.category;

import app.accountbook.common.DuplicateCategoryNameException;
import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InUseException;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.InvalidStateException;
import app.accountbook.common.Names;
import app.accountbook.common.NotLedgerMemberException;
import app.accountbook.common.Times;
import app.accountbook.ledger.LedgerAccess;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
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
     * 카테고리는 2단계까지다. 상위는 같은 장부·같은 구분의 최상위 분류이고 미분류는 아니다(F-510).
     * 이름은 앞뒤 공백을 지운 1~20자이고 같은 상위 아래에서 겹칠 수 없다(P-221).
     * 틀린 입력란은 모두 한 번에 알리고, 같은 이름은 나머지가 모두 맞을 때만 본다(#44, 계좌의 #13과 같다).
     */
    @Transactional
    public Category create(UUID actorId, UUID ledgerId, CategoryCommand cmd) {
        ledgerAccess.requireMember(actorId, ledgerId);
        if (cmd == null) {
            throw new InvalidRequestException(InvalidRequestException.WHOLE_BODY, FieldErrorCode.REQUIRED,
                    "카테고리 정보가 없습니다.");
        }
        List<InvalidRequestException> errors = new ArrayList<>();
        if (cmd.kind() == null) {
            errors.add(new InvalidRequestException("kind", FieldErrorCode.REQUIRED, "수입·지출 구분이 없습니다."));
        }
        String name = normalizeName(cmd.name(), errors);
        if (cmd.parentId() != null) {
            parentError(ledgerId, cmd.kind(), cmd.parentId()).ifPresent(errors::add);
        }
        if (!errors.isEmpty()) {
            throw InvalidRequestException.ofAll(errors);
        }
        Category category = Category.of(ledgerId, cmd.kind(), name, cmd.parentId());
        requireUniqueName(category, name);
        return saveUnlessDuplicate(category);
    }

    /**
     * 이름만 바꾼다(F-511). 검증은 만들기와 같고 자기 이름과는 겹치지 않는 것으로 본다. 같은 이름이면 바뀌는 것이 없다.
     * 그 장부의 카테고리가 아니면(내가 구성원인 다른 장부의 것, 없거나 지운 것) 구성원이 아닌 것과 같은 예외이고 검증보다 먼저다.
     * 미분류는 입력 검증을 지난 뒤 상태 오류로 거부한다(ADR 002 5절의 순서).
     */
    @Transactional
    public Category rename(UUID actorId, UUID ledgerId, UUID categoryId, String name) {
        ledgerAccess.requireMember(actorId, ledgerId);
        Category category = categoryRepository.findById(categoryId)
                .filter(found -> found.getLedgerId().equals(ledgerId))
                .orElseThrow(NotLedgerMemberException::new);
        String newName = Names.normalize(name, Category.NAME_MAX_LENGTH);
        requireUniqueName(category, newName);
        if (category.isSystem()) {
            throw new InvalidStateException("기본 카테고리(미분류)의 이름은 바꿀 수 없습니다.");
        }
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

    /** 규칙에 맞으면 맞춘 이름을, 아니면 오류를 모으고 null을 돌려준다. */
    private static String normalizeName(String raw, List<InvalidRequestException> errors) {
        try {
            return Names.normalize(raw, Category.NAME_MAX_LENGTH);
        } catch (InvalidRequestException e) {
            errors.add(e);
            return null;
        }
    }

    /**
     * 상위가 이 장부에 없으면(다른 장부의 것, 지운 것 포함) NOT_FOUND, 하위면 TOO_DEEP, 구분이 다르면 TYPE_MISMATCH,
     * 미분류면 NOT_ALLOWED다(#44). 구분이 없으면 구분은 비교하지 않는다(그 오류는 {@code kind}에 따로 있다).
     */
    private Optional<InvalidRequestException> parentError(UUID ledgerId, CategoryKind kind, UUID parentId) {
        Optional<Category> parent = categoryRepository.findById(parentId)
                .filter(candidate -> candidate.getLedgerId().equals(ledgerId));
        if (parent.isEmpty()) {
            return Optional.of(new InvalidRequestException("parentId", FieldErrorCode.NOT_FOUND,
                    "상위 분류를 찾을 수 없습니다."));
        }
        if (!parent.get().isTopLevel()) {
            return Optional.of(new InvalidRequestException("parentId", FieldErrorCode.TOO_DEEP,
                    "카테고리는 2단계까지만 만들 수 있습니다."));
        }
        if (kind != null && parent.get().getKind() != kind) {
            return Optional.of(new InvalidRequestException("parentId", FieldErrorCode.TYPE_MISMATCH,
                    "상위 분류와 수입·지출 구분이 같아야 합니다."));
        }
        if (parent.get().isSystem()) {
            return Optional.of(new InvalidRequestException("parentId", FieldErrorCode.NOT_ALLOWED,
                    "기본 카테고리(미분류) 아래에는 만들 수 없습니다."));
        }
        return Optional.empty();
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

    /** 삭제(#35)의 거부. 어느 입력란의 잘못도 아니어서 본문 전체의 오류로 알린다. 지금까지와 같은 응답이다. */
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
