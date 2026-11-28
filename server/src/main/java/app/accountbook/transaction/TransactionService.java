package app.accountbook.transaction;

import app.accountbook.account.Account;
import app.accountbook.account.AccountRepository;
import app.accountbook.category.Category;
import app.accountbook.category.CategoryKind;
import app.accountbook.category.CategoryRepository;
import app.accountbook.category.CategoryService;
import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.InvalidStateException;
import app.accountbook.common.NotFoundException;
import app.accountbook.common.Times;
import app.accountbook.common.UserText;
import app.accountbook.ledger.Ledger;
import app.accountbook.ledger.LedgerAccess;
import app.accountbook.ledger.LedgerRepository;
import app.accountbook.transaction.TransactionCommand.Entry;
import app.accountbook.transaction.TransactionCommand.Transfer;
import app.accountbook.transaction.TransactionView.Line;
import jakarta.persistence.EntityManager;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.function.Supplier;
import java.util.stream.Collectors;
import org.hibernate.exception.ConstraintViolationException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 거래 쓰기(생성·수정·취소·취소 되돌리기·삭제·복원)와 조회. 모든 쓰기는 change_log에 1행을 남긴다.
 * 수정 계열은 version이 맞을 때만 조건부 UPDATE로 반영하고, 아니면 아무것도 바꾸지 않는다.
 */
@Service
public class TransactionService {

    static final int PAYEE_MAX_LENGTH = 100;
    static final int MEMO_MAX_LENGTH = 500;

    /** 기기 값의 형식 오류를 알리는 입력란({@code deviceId} 인자). API는 기기 값을 받은 자리의 이름으로 바꿔 알린다. */
    public static final String DEVICE_ID_FIELD = DeviceIds.FIELD;

    /** V1 마이그레이션의 거래 기본키 제약 이름. */
    private static final String ID_CONSTRAINT = "transaction_pkey";

    /** V10 마이그레이션의 (id, ledger_id) 유니크. 같은 장부의 같은 id는 이것과 기본키 중 DB가 먼저 본 쪽에 걸린다. */
    private static final String ID_LEDGER_CONSTRAINT = "uq_transaction_id_ledger";

    private final TransactionRepository transactionRepository;
    private final ChangeLogRepository changeLogRepository;
    private final AccountRepository accountRepository;
    private final CategoryRepository categoryRepository;
    private final CategoryService categoryService;
    private final LedgerAccess ledgerAccess;
    private final LedgerRepository ledgerRepository;
    private final Clock clock;
    private final TransactionTemplate transactionTemplate;
    private final EntityManager entityManager;

    TransactionService(TransactionRepository transactionRepository, ChangeLogRepository changeLogRepository,
                       AccountRepository accountRepository, CategoryRepository categoryRepository,
                       CategoryService categoryService, LedgerAccess ledgerAccess,
                       LedgerRepository ledgerRepository, Clock clock, TransactionTemplate transactionTemplate,
                       EntityManager entityManager) {
        this.transactionRepository = transactionRepository;
        this.changeLogRepository = changeLogRepository;
        this.accountRepository = accountRepository;
        this.categoryRepository = categoryRepository;
        this.categoryService = categoryService;
        this.ledgerAccess = ledgerAccess;
        this.ledgerRepository = ledgerRepository;
        this.clock = clock;
        this.transactionTemplate = transactionTemplate;
        this.entityManager = entityManager;
    }

    /** {@link #createOrReplay}와 같고, 새로 만들었는지 알 필요가 없을 때 쓴다. */
    public TransactionView create(UUID actorId, UUID ledgerId, TransactionCommand cmd, String deviceId) {
        return createOrReplay(actorId, ledgerId, cmd, deviceId).transaction();
    }

    /**
     * 거래를 만든다. id는 클라이언트 값이다. 같은 id의 거래가 이미 있으면(휴지통에 있는 것 포함) 새로 만들지 않고
     * 재전송으로 답하거나 {@link IdConflictException}으로 거부한다(판정은 {@link #replay}).
     * 재전송은 아무것도 바꾸지 않고 이력도 남기지 않는다. 완전히 지운 거래의 id도 거부한다.
     *
     * <p>검사 순서(ADR 006 결정 4): 구성원 → 형식 검증 → 같은 id 조회 → 참조 검증 → 저장.
     * 이미 저장된 거래의 재전송이 그사이 없어진 계좌나 카테고리 때문에 거부되지 않게 한다.
     *
     * <p>같은 id의 요청이 동시에 와서 둘 다 "같은 id 없음"을 보면, 나중 것이 앞 것의 커밋을 기다렸다가 기본키 위반을
     * 만난다. 위반이 난 트랜잭션에서는 더 조회할 수 없으므로 새 트랜잭션에서 처음부터 다시 판정한다. 그래서 트랜잭션을
     * 여기서 열고, 이미 열린 트랜잭션 안에서 부르지 않는다(ADR 004 결정 6: api는 트랜잭션을 열지 않는다).
     */
    public CreateResult createOrReplay(UUID actorId, UUID ledgerId, TransactionCommand cmd, String deviceId) {
        Supplier<CreateResult> attempt = () -> transactionTemplate.execute(
                status -> judgeAndCreate(actorId, ledgerId, cmd, deviceId));
        try {
            return attempt.get();
        } catch (DataIntegrityViolationException e) {
            if (!isIdTaken(e)) {
                throw e;
            }
            return attempt.get();
        }
    }

    private CreateResult judgeAndCreate(UUID actorId, UUID ledgerId, TransactionCommand cmd, String deviceId) {
        ledgerAccess.requireMember(actorId, ledgerId);
        DeviceIds.requireValidFormat(deviceId);
        Content content = normalize(ledgerId, cmd, actorId);
        // 판정은 한 시점에 읽은 거래 전체로 한다(#202). 그 시점에 이미 완전히 지워졌으면 아래의 기록 확인이 거부한다.
        Optional<Transaction> existing = transactionRepository.findWithLinesById(content.id());
        if (existing.isPresent()) {
            return new CreateResult(replay(existing.get(), actorId, ledgerId, content), false);
        }
        requireNotPurged(content.id());
        requireReferences(ledgerId, cmd, Set.of());
        Transaction tx = Transaction.of(content.id(), ledgerId, content.type(), content.occurredOn(),
                content.occurredTime(), content.payee(), content.memo(), actorId, content.paidBy());
        content.lines().forEach(line -> tx.addLine(line.accountId(), line.categoryId(), line.amount()));
        // 바로 flush해서 기본키 위반을 다른 오류와 섞이기 전에 받는다.
        transactionRepository.saveAndFlush(tx);
        // 앞의 확인 뒤에 같은 id가 만들어지고 완전히 지워졌으면 부딪힐 행이 없어 INSERT가 된다. INSERT는 그 삭제의 커밋을
        // 기다리므로 여기서는 기록이 보인다.
        requireNotPurged(content.id());
        appendLog(tx, ChangeAction.CREATE, actorId, deviceId, null);
        return new CreateResult(TransactionView.of(tx, actorId), true);
    }

    /** 완전히 지운 거래의 id는 어느 장부의 것이었든 다시 쓸 수 없다(ADR 007 결정 7). */
    private void requireNotPurged(UUID txId) {
        if (changeLogRepository.existsByTransactionIdAndActionIn(txId, ChangeAction.PURGES)) {
            throw IdConflictException.unusableId();
        }
    }

    private static boolean isIdTaken(DataIntegrityViolationException e) {
        return e.getCause() instanceof ConstraintViolationException violation
                && (ID_CONSTRAINT.equals(violation.getConstraintName())
                || ID_LEDGER_CONSTRAINT.equals(violation.getConstraintName()));
    }

    /**
     * 내용과 라인을 통째로 바꾼다. 거래 종류는 바꿀 수 없다. paidBy가 null이면 기존 값을 유지한다.
     *
     * <p>검사 순서(#36): 구성원 → 형식(기기 값, 입력란, 종류) → version → 상태(휴지통) → 참조 → 저장. 만들기와 같은 형식
     * 검증이다. 값 맞추기를 거친 내용이 저장된 것과 같으면 바꾸지 않고(version 그대로, 이력 없음) 지금 거래를 돌려준다.
     * 비교는 재전송 판정과 같다(ADR 006 결정 3).
     */
    @Transactional
    public TransactionView update(UUID actorId, UUID txId, long expectedVersion, TransactionCommand cmd,
                                  String deviceId) {
        Transaction tx = loadAccessible(actorId, txId);
        DeviceIds.requireValidFormat(deviceId);
        Content content = normalize(tx.getLedgerId(), cmd, tx.getPaidBy());
        if (!tx.getId().equals(content.id())) {
            throw new InvalidRequestException("id", FieldErrorCode.NOT_ALLOWED, "요청의 거래 id가 수정 대상과 다릅니다.");
        }
        if (content.type() != tx.getType()) {
            throw new InvalidRequestException("type", FieldErrorCode.NOT_ALLOWED, "거래 종류는 바꿀 수 없습니다.");
        }
        requireVersion(tx, expectedVersion);
        requireNotDeleted(tx, "삭제된 거래는 수정할 수 없습니다.");
        requireReferences(tx.getLedgerId(), cmd, accountIdsOf(tx));
        if (Content.of(tx).sameAs(content)) {
            return view(tx);
        }
        return write(tx, expectedVersion, ChangeAction.UPDATE, actorId, deviceId, now -> {
            tx.changeDetails(content.occurredOn(), content.occurredTime(), content.payee(), content.memo(),
                    content.paidBy());
            tx.clearLines();
            content.lines().forEach(line -> tx.addLine(line.accountId(), line.categoryId(), line.amount()));
        });
    }

    /** 승인취소. 거래는 남고 잔액·통계에서 빠진다. */
    @Transactional
    public TransactionView cancel(UUID actorId, UUID txId, long expectedVersion, String deviceId) {
        Transaction tx = loadAccessible(actorId, txId);
        DeviceIds.requireValidFormat(deviceId);
        requireVersion(tx, expectedVersion);
        requireNotDeleted(tx, "삭제된 거래는 취소할 수 없습니다.");
        if (tx.getStatus() == TransactionStatus.CANCELED) {
            throw new InvalidStateException("이미 취소된 거래입니다.");
        }
        return write(tx, expectedVersion, ChangeAction.CANCEL, actorId, deviceId, now -> tx.cancel());
    }

    /**
     * 승인취소 되돌리기(F-226). 취소 직전 상태로 돌아가 잔액·통계에 다시 든다. 취소한 거래에만 되고, 휴지통의 거래는 안 된다.
     * 검사 순서는 취소와 같다: 구성원 → 기기 값 → version → 휴지통 → 상태.
     */
    @Transactional
    public TransactionView uncancel(UUID actorId, UUID txId, long expectedVersion, String deviceId) {
        Transaction tx = loadAccessible(actorId, txId);
        DeviceIds.requireValidFormat(deviceId);
        requireVersion(tx, expectedVersion);
        requireNotDeleted(tx, "삭제된 거래는 취소를 되돌릴 수 없습니다.");
        if (tx.getStatus() != TransactionStatus.CANCELED) {
            throw new InvalidStateException("취소한 거래만 되돌릴 수 있습니다.");
        }
        return write(tx, expectedVersion, ChangeAction.UNCANCEL, actorId, deviceId, now -> tx.uncancel());
    }

    /** 소프트 삭제(휴지통으로). */
    @Transactional
    public TransactionView delete(UUID actorId, UUID txId, long expectedVersion, String deviceId) {
        Transaction tx = loadAccessible(actorId, txId);
        DeviceIds.requireValidFormat(deviceId);
        requireVersion(tx, expectedVersion);
        requireNotDeleted(tx, "이미 삭제된 거래입니다.");
        return write(tx, expectedVersion, ChangeAction.DELETE, actorId, deviceId, tx::markDeleted);
    }

    /** 휴지통에서 되살린다. 삭제된 거래에만 된다. */
    @Transactional
    public TransactionView restore(UUID actorId, UUID txId, long expectedVersion, String deviceId) {
        Transaction tx = loadAccessible(actorId, txId);
        DeviceIds.requireValidFormat(deviceId);
        requireVersion(tx, expectedVersion);
        if (!tx.isDeleted()) {
            throw new InvalidStateException("삭제된 거래만 복원할 수 있습니다.");
        }
        return write(tx, expectedVersion, ChangeAction.RESTORE, actorId, deviceId, now -> tx.restore());
    }

    /** 삭제된 거래도 돌려준다(deleted=true). */
    @Transactional(readOnly = true)
    public TransactionView get(UUID actorId, UUID txId) {
        return view(loadAccessible(actorId, txId));
    }

    /** 거래의 변경 이력, 오래된 순(version 순). */
    @Transactional(readOnly = true)
    public List<ChangeLogView> history(UUID actorId, UUID txId) {
        Transaction tx = loadAccessible(actorId, txId);
        return changeLogRepository.findByTransactionIdOrderByVersionAsc(tx.getId()).stream()
                .map(ChangeLogView::of)
                .toList();
    }

    /**
     * 같은 id의 거래가 있을 때의 판정(ADR 006 결정 3). 재전송이면 그 거래의 지금 내용을 돌려준다.
     * 만든 뒤 고쳐졌으면(version 2 이상) 내용을 비교하지 않는다. 다른 기기가 고친 뒤의 재전송이 충돌로 보이지 않게 한다.
     */
    private TransactionView replay(Transaction existing, UUID actorId, UUID ledgerId, Content requested) {
        if (!existing.getLedgerId().equals(ledgerId) || !actorId.equals(existing.getCreatedBy())) {
            throw IdConflictException.unusableId();
        }
        TransactionView current = view(existing);
        boolean neverChanged = existing.getVersion() == Transaction.INITIAL_VERSION;
        if (neverChanged && !Content.of(existing).sameAs(requested)) {
            throw IdConflictException.differentContent(current);
        }
        return current;
    }

    /**
     * version을 조건부 UPDATE로 올린 뒤에만 변경을 적용하고 이력을 남긴다.
     * 영향 행이 0이면 그 사이 다른 요청이 먼저 바꾼 것이므로 아무것도 바꾸지 않고 거부한다.
     */
    private TransactionView write(Transaction tx, long expectedVersion, ChangeAction action, UUID actorId,
                                  String deviceId, Consumer<Instant> change) {
        ChangeLogValue before = ChangeLogValue.of(tx);
        Instant now = Times.now();
        if (transactionRepository.advanceVersion(tx.getId(), expectedVersion, now) == 0) {
            throw changedMeanwhile(tx);
        }
        tx.applyVersion(expectedVersion + 1, now);
        change.accept(now);
        appendLog(tx, action, actorId, deviceId, before);
        return TransactionView.of(tx, actorId);
    }

    /**
     * 읽은 거래의 읽기 모델. 고친 사람은 그 거래의 version까지의 마지막 이력을 남긴 사람이다(ADR 002 2절). 거래를 읽은 뒤
     * 다른 요청이 고쳐 이력이 늘어도 읽은 내용과 어긋나지 않는다. 탈퇴로 비워졌으면 null이다(ADR 007 결정 5).
     */
    private TransactionView view(Transaction tx) {
        UUID updatedBy = changeLogRepository
                .findFirstByTransactionIdAndVersionLessThanEqualOrderByVersionDesc(tx.getId(), tx.getVersion())
                .map(ChangeLog::getActorId)
                .orElse(null);
        return TransactionView.of(tx, updatedBy);
    }

    /** 거래가 이 변경 뒤의 내용과 version이 된 다음에 부른다. 이력의 후 값과 번호가 그 값이다. */
    private void appendLog(Transaction tx, ChangeAction action, UUID actorId, String deviceId,
                           ChangeLogValue before) {
        changeLogRepository.save(ChangeLog.of(tx.getId(), tx.getLedgerId(), tx.getVersion(), action, actorId,
                deviceId, before, ChangeLogValue.of(tx), nextLogTime(tx.getId())));
    }

    /**
     * 이력 시각은 거래마다 엄격히 증가하게 한다. 순서는 version이 정하지만, 같은 마이크로초에 두 번 쓰이거나 시계가
     * 뒤로 가도 보이는 시각이 그 순서를 거스르지 않게 한다.
     */
    private Instant nextLogTime(UUID txId) {
        Instant now = Times.now();
        return changeLogRepository.findFirstByTransactionIdOrderByVersionDesc(txId)
                .map(ChangeLog::getCreatedAt)
                .filter(last -> !now.isAfter(last))
                .map(last -> last.plus(1, ChronoUnit.MICROS))
                .orElse(now);
    }

    /** 없는 거래와 구성원이 아닌 장부의 거래를 구분하지 않는다. 라인을 함께 읽는다(#202). */
    private Transaction loadAccessible(UUID actorId, UUID txId) {
        return Optional.ofNullable(txId)
                .flatMap(transactionRepository::findWithLinesById)
                .filter(tx -> ledgerAccess.isMember(actorId, tx.getLedgerId()))
                .orElseThrow(NotFoundException::new);
    }

    /**
     * 상태 확인이 호출자가 본 바로 그 version에 대해 이뤄지도록 먼저 비교한다. 동시성은 조건부 UPDATE가 막는다.
     * 거래는 이 트랜잭션에서 처음 읽은 것이라 거래와 라인이 한 시점의 값이고, 그것이 최신 내용이다.
     */
    private void requireVersion(Transaction tx, long expectedVersion) {
        if (tx.getVersion() != expectedVersion) {
            throw new StaleVersionException(view(tx));
        }
    }

    /**
     * 읽은 뒤 다른 요청이 먼저 바꿔 조건부 UPDATE가 0행이었다. 읽어 둔 거래는 낡았고, 같은 영속성 컨텍스트에서 다시 찾으면 그
     * 낡은 것이 돌아오므로 떼어 내고 한 문장으로 새로 읽는다(#36, #202). 그사이 완전히 지워졌으면 없는 거래다.
     */
    private StaleVersionException changedMeanwhile(Transaction stale) {
        entityManager.detach(stale);
        return transactionRepository.findWithLinesById(stale.getId())
                .map(fresh -> new StaleVersionException(view(fresh)))
                .orElseThrow(NotFoundException::new);
    }

    private static void requireNotDeleted(Transaction tx, String message) {
        if (tx.isDeleted()) {
            throw new InvalidStateException(message);
        }
    }

    /**
     * 형식 검증(필수 항목, 형식, 범위)과 비교 전의 값 맞추기. 계좌와 카테고리가 장부에 있는지는 보지 않는다.
     * 가맹점과 메모의 글자 규칙(P-214, {@link UserText})도 여기서 본다. 같은 id 조회보다 앞이다(ADR 006 결정 4).
     * 돌려주는 값은 저장할 내용이고 재전송 비교에도 쓴다.
     */
    private Content normalize(UUID ledgerId, TransactionCommand cmd, UUID defaultPaidBy) {
        return switch (cmd) {
            case null -> throw new InvalidRequestException(InvalidRequestException.WHOLE_BODY, FieldErrorCode.REQUIRED,
                    "거래 정보가 없습니다.");
            case Entry entry -> normalizeEntry(ledgerId, entry, defaultPaidBy);
            case Transfer transfer -> normalizeTransfer(ledgerId, transfer);
        };
    }

    /** 라인 부호: 지출 -amount, 환불(지출) +amount, 수입 +amount. 카테고리가 없으면 미분류. */
    private Content normalizeEntry(UUID ledgerId, Entry entry, UUID defaultPaidBy) {
        requireHeader(entry.id(), entry.occurredOn());
        requireDateInRange(ledgerId, entry.occurredOn());
        if (entry.type() == null) {
            throw new InvalidRequestException("type", FieldErrorCode.REQUIRED, "거래 종류가 없습니다.");
        }
        if (entry.type() != TransactionType.EXPENSE && entry.type() != TransactionType.INCOME) {
            throw new InvalidRequestException("type", FieldErrorCode.NOT_ALLOWED, "지출 또는 수입만 입력할 수 있습니다.");
        }
        TransactionLimits.requireAmountInRange(entry.amount());
        if (entry.refund() && entry.type() == TransactionType.INCOME) {
            throw new InvalidRequestException("refund", FieldErrorCode.NOT_ALLOWED, "환불은 지출에만 표시할 수 있습니다.");
        }
        String payee = UserText.payee(entry.payee(), PAYEE_MAX_LENGTH);
        String memo = UserText.memo(entry.memo(), MEMO_MAX_LENGTH);
        requireAccountGiven("accountId", entry.accountId());
        UUID categoryId = entry.categoryId() == null
                ? categoryService.uncategorized(ledgerId, categoryKind(entry)).getId()
                : entry.categoryId();
        UUID paidBy = entry.paidBy() == null ? defaultPaidBy : entry.paidBy();
        boolean increasesBalance = entry.type() == TransactionType.INCOME || entry.refund();
        long amount = increasesBalance ? entry.amount() : -entry.amount();
        return new Content(entry.id(), entry.type(), entry.occurredOn(),
                Transaction.storableTime(entry.occurredTime()), payee, memo, paidBy,
                List.of(new Line(entry.accountId(), categoryId, amount)));
    }

    /** 이체: from 라인 -amount, to 라인 +amount. 카테고리·paidBy·payee가 없다. */
    private Content normalizeTransfer(UUID ledgerId, Transfer transfer) {
        requireHeader(transfer.id(), transfer.occurredOn());
        requireDateInRange(ledgerId, transfer.occurredOn());
        TransactionLimits.requireAmountInRange(transfer.amount());
        String memo = UserText.memo(transfer.memo(), MEMO_MAX_LENGTH);
        requireAccountGiven("fromAccountId", transfer.fromAccountId());
        requireAccountGiven("toAccountId", transfer.toAccountId());
        if (transfer.fromAccountId().equals(transfer.toAccountId())) {
            throw new InvalidRequestException("toAccountId", FieldErrorCode.NOT_ALLOWED, "같은 계좌로는 이체할 수 없습니다.");
        }
        return new Content(transfer.id(), TransactionType.TRANSFER, transfer.occurredOn(),
                Transaction.storableTime(transfer.occurredTime()), null, memo, null,
                List.of(new Line(transfer.fromAccountId(), null, -transfer.amount()),
                        new Line(transfer.toAccountId(), null, transfer.amount())));
    }

    /**
     * 참조 검증: 계좌와 카테고리가 이 장부에 있는지, 카테고리의 수입·지출 구분이 맞는지, 결제한 사람이 구성원인지.
     * {@link #normalize}를 통과한 요청에만 쓴다. 없거나 다른 장부의 것은 구분하지 않고 그 입력란의 {@code NOT_FOUND}다.
     * 숨긴 계좌는 그 입력란의 {@code NOT_ALLOWED}다(P-220). 단 고치는 거래가 이미 쓰는 계좌({@code keptAccountIds})는 숨겼어도
     * 된다. 숨기기 전의 거래를 계좌를 바꾸지 않고 고칠 수 있게 한다.
     */
    private void requireReferences(UUID ledgerId, TransactionCommand cmd, Set<UUID> keptAccountIds) {
        switch (cmd) {
            case Entry entry -> {
                requireAccountInLedger(ledgerId, "accountId", entry.accountId(), keptAccountIds);
                if (entry.categoryId() != null) {
                    requireCategoryInLedger(ledgerId, categoryKind(entry), entry.categoryId());
                }
                if (entry.paidBy() != null) {
                    requirePayer(ledgerId, entry.paidBy());
                }
            }
            case Transfer transfer -> {
                requireAccountInLedger(ledgerId, "fromAccountId", transfer.fromAccountId(), keptAccountIds);
                requireAccountInLedger(ledgerId, "toAccountId", transfer.toAccountId(), keptAccountIds);
            }
        }
    }

    private static CategoryKind categoryKind(Entry entry) {
        return entry.type() == TransactionType.EXPENSE ? CategoryKind.EXPENSE : CategoryKind.INCOME;
    }

    private static void requireAccountGiven(String field, UUID accountId) {
        if (accountId == null) {
            throw new InvalidRequestException(field, FieldErrorCode.REQUIRED, "계좌가 없습니다.");
        }
    }

    private static void requireHeader(UUID id, LocalDate occurredOn) {
        if (id == null) {
            throw new InvalidRequestException("id", FieldErrorCode.REQUIRED, "거래 id가 없습니다.");
        }
        if (occurredOn == null) {
            throw new InvalidRequestException("occurredOn", FieldErrorCode.REQUIRED, "거래 날짜가 없습니다.");
        }
    }

    /** "오늘"은 서버 시계의 지금을 그 장부의 시간대로 본 날짜다(P-202). */
    private void requireDateInRange(UUID ledgerId, LocalDate occurredOn) {
        ZoneId ledgerZone = ledgerRepository.findById(ledgerId)
                .map(Ledger::zoneId)
                .orElseThrow(NotFoundException::new);
        TransactionLimits.requireDateInRange(occurredOn, clock, ledgerZone);
    }

    private void requireAccountInLedger(UUID ledgerId, String field, UUID accountId, Set<UUID> keptAccountIds) {
        Account account = accountRepository.findById(accountId)
                .filter(found -> found.getLedgerId().equals(ledgerId))
                .orElseThrow(() -> new InvalidRequestException(field, FieldErrorCode.NOT_FOUND, "장부에 없는 계좌입니다."));
        if (account.isHidden() && !keptAccountIds.contains(accountId)) {
            throw new InvalidRequestException(field, FieldErrorCode.NOT_ALLOWED, "숨긴 계좌로는 거래를 입력할 수 없습니다.");
        }
    }

    private static Set<UUID> accountIdsOf(Transaction tx) {
        return tx.getLines().stream().map(TransactionLine::getAccountId).collect(Collectors.toUnmodifiableSet());
    }

    /** 카테고리를 FK 확인과 같은 잠금으로 거래 행보다 먼저 읽는다. 지우는 중이면 기다렸다가 없는 카테고리로 거부한다(#3). */
    private void requireCategoryInLedger(UUID ledgerId, CategoryKind kind, UUID categoryId) {
        Category category = categoryRepository.findForReference(ledgerId, categoryId)
                .orElseThrow(() -> new InvalidRequestException("categoryId", FieldErrorCode.NOT_FOUND,
                        "장부에 없는 카테고리입니다."));
        if (category.getKind() != kind) {
            throw new InvalidRequestException("categoryId", FieldErrorCode.NOT_ALLOWED,
                    "거래 종류와 카테고리의 수입·지출 구분이 다릅니다.");
        }
    }

    private void requirePayer(UUID ledgerId, UUID paidBy) {
        if (!ledgerAccess.isMember(paidBy, ledgerId)) {
            throw new InvalidRequestException("paidBy", FieldErrorCode.NOT_ALLOWED, "결제한 사람은 장부 구성원이어야 합니다.");
        }
    }

    /** 형식 검증을 지난 요청의 저장 내용. 재전송 비교에도 쓴다. */
    private record Content(UUID id, TransactionType type, LocalDate occurredOn, LocalTime occurredTime,
                           String payee, String memo, UUID paidBy, List<Line> lines) {

        /**
         * 저장된 거래를 요청과 같은 값 맞추기(P-214)에 통과시킨 내용. 이 규칙 전에 다듬지 않고 저장된 가맹점과 메모
         * (앞뒤 공백, 분해형, 빈 문자열)의 재전송이 다른 내용으로 보이지 않게 한다(ADR 006 결정 3). 저장된 값은 거부하지 않는다.
         */
        static Content of(Transaction tx) {
            return new Content(tx.getId(), tx.getType(), tx.getOccurredOn(), tx.getOccurredTime(),
                    UserText.comparablePayee(tx.getPayee()), UserText.comparableMemo(tx.getMemo()), tx.getPaidBy(),
                    tx.getLines().stream().map(Line::of).toList());
        }

        /** 같은 내용: type, 날짜, 시각, payee, memo, paidBy와 라인 (계좌, 카테고리, 금액)의 다중집합이 같다. */
        boolean sameAs(Content other) {
            return type == other.type
                    && Objects.equals(occurredOn, other.occurredOn)
                    && Objects.equals(occurredTime, other.occurredTime)
                    && Objects.equals(payee, other.payee)
                    && Objects.equals(memo, other.memo)
                    && Objects.equals(paidBy, other.paidBy)
                    && lineCounts().equals(other.lineCounts());
        }

        private Map<Line, Long> lineCounts() {
            return lines.stream().collect(Collectors.groupingBy(Function.identity(), Collectors.counting()));
        }
    }
}
