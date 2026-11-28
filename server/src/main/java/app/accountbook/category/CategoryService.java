package app.accountbook.category;

import app.accountbook.common.DuplicateCategoryNameException;
import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.InvalidStateException;
import app.accountbook.common.Names;
import app.accountbook.common.NotLedgerMemberException;
import app.accountbook.common.Times;
import app.accountbook.ledger.LedgerAccess;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.hibernate.exception.ConstraintViolationException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CategoryService {

    /** 삭제할 때 옮길 곳의 입력란 이름(#35의 요청 칸). */
    private static final String TARGET_FIELD = "targetCategoryId";

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
     * 읽은 뒤 저장하기 전에 {@link #delete}가 커밋되면 저장이 0행이 되는데, 이것도 지운 것과 같은 예외다(#35).
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
        try {
            return saveUnlessDuplicate(category);
        } catch (OptimisticLockingFailureException e) {
            throw new NotLedgerMemberException();
        }
    }

    /** 지우면 옮겨질 거래 수(F-512). 하위, 휴지통, 취소한 거래를 포함해 거래 단위로 센다. 거부는 {@link #delete}와 같다. */
    @Transactional(readOnly = true)
    public long countAffectedTransactions(UUID actorId, UUID ledgerId, UUID categoryId) {
        ledgerAccess.requireMember(actorId, ledgerId);
        Category category = categoryRepository.findById(categoryId)
                .filter(found -> found.getLedgerId().equals(ledgerId))
                .orElseThrow(NotLedgerMemberException::new);
        requireNotSystem(category);
        return categoryUsage.countTransactions(ledgerId,
                idsOf(category, categoryRepository.findByLedgerIdAndParentId(ledgerId, categoryId)));
    }

    /**
     * 카테고리와 하위를 지우고 그 라인(휴지통, 취소 포함)을 옮길 곳(null이면 같은 구분의 미분류)으로 옮긴다. 한 트랜잭션이다(P-222).
     * 검사 순서(ADR 002 5절): 구성원 → 이 장부의 카테고리(아니면 구성원이 아닌 것과 같은 예외) → 옮길 곳({@value #TARGET_FIELD}) →
     * 미분류(상태 오류) → 기기 값 형식. 동시성: 카테고리와 하위를 FOR UPDATE로 잠근다. 거래 쓰기는 카테고리를 FOR KEY SHARE로 먼저
     * 읽으므로, 삭제 중에 들어오는 거래는 커밋을 기다렸다가 없는 카테고리로 거부되고 먼저 들어온 거래는 삭제가 기다렸다가 함께 옮긴다.
     */
    @Transactional
    public void delete(UUID actorId, UUID ledgerId, UUID categoryId, UUID targetCategoryId, String deviceId) {
        ledgerAccess.requireMember(actorId, ledgerId);
        Category category = categoryRepository.lockForDelete(ledgerId, categoryId)
                .orElseThrow(NotLedgerMemberException::new);
        List<Category> children = categoryRepository.lockChildrenForDelete(ledgerId, categoryId);
        Set<UUID> removed = idsOf(category, children);
        UUID target = targetCategoryId == null ? null : requireTarget(category, removed, targetCategoryId);
        requireNotSystem(category);
        categoryUsage.moveLines(ledgerId, removed,
                target == null ? uncategorized(ledgerId, category.getKind()).getId() : target, actorId, deviceId);
        // 하위가 상위를 가리키므로(fk_category_parent) 하위부터 지운다. 남은 라인이 있으면 FK가 여기서 막는다.
        categoryRepository.deleteAll(Stream.concat(children.stream(), Stream.of(category)).toList());
        categoryRepository.flush();
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
     * 상위가 이 장부에 없으면(다른 장부의 것, 지운 것, 지우는 중이던 것 포함) NOT_FOUND, 하위면 TOO_DEEP, 구분이 다르면 KIND_MISMATCH,
     * 미분류면 NOT_ALLOWED다(#44). 구분이 없으면 구분은 비교하지 않는다(그 오류는 {@code kind}에 따로 있다).
     */
    private Optional<InvalidRequestException> parentError(UUID ledgerId, CategoryKind kind, UUID parentId) {
        Optional<Category> parent = categoryRepository.findForReference(ledgerId, parentId);
        if (parent.isEmpty()) {
            return Optional.of(new InvalidRequestException("parentId", FieldErrorCode.NOT_FOUND,
                    "상위 분류를 찾을 수 없습니다."));
        }
        if (!parent.get().isTopLevel()) {
            return Optional.of(new InvalidRequestException("parentId", FieldErrorCode.TOO_DEEP,
                    "카테고리는 2단계까지만 만들 수 있습니다."));
        }
        if (kind != null && parent.get().getKind() != kind) {
            return Optional.of(new InvalidRequestException("parentId", FieldErrorCode.KIND_MISMATCH,
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

    /** 미분류는 지울 수 없다(P-222). 이름 바꾸기(#44)와 같은 상태 오류다. */
    private static void requireNotSystem(Category category) {
        if (category.isSystem()) {
            throw new InvalidStateException("기본 카테고리(미분류)는 지울 수 없습니다.");
        }
    }

    /** 옮길 곳은 이 장부에 있고(다른 장부, 없는 것, 지운 것은 NOT_FOUND) 같은 구분이며 지울 카테고리와 하위가 아니다(P-222). */
    private UUID requireTarget(Category category, Set<UUID> removed, UUID targetId) {
        if (removed.contains(targetId)) {
            throw new InvalidRequestException(TARGET_FIELD, FieldErrorCode.NOT_ALLOWED,
                    "지울 카테고리와 그 하위로는 옮길 수 없습니다.");
        }
        Category target = categoryRepository.findForReference(category.getLedgerId(), targetId)
                .orElseThrow(() -> new InvalidRequestException(TARGET_FIELD, FieldErrorCode.NOT_FOUND,
                        "옮길 카테고리를 찾을 수 없습니다."));
        if (target.getKind() != category.getKind()) {
            throw new InvalidRequestException(TARGET_FIELD, FieldErrorCode.KIND_MISMATCH,
                    "옮길 카테고리는 지울 카테고리와 수입·지출 구분이 같아야 합니다.");
        }
        return target.getId();
    }

    private static Set<UUID> idsOf(Category category, List<Category> children) {
        return Stream.concat(Stream.of(category), children.stream())
                .map(Category::getId)
                .collect(Collectors.toUnmodifiableSet());
    }

}
