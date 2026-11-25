package app.accountbook.transaction;

import app.accountbook.account.Account;
import app.accountbook.account.AccountRepository;
import app.accountbook.category.Category;
import app.accountbook.category.CategoryKind;
import app.accountbook.category.CategoryRepository;
import app.accountbook.category.CategoryService;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.NotFoundException;
import app.accountbook.common.StaleVersionException;
import app.accountbook.common.Times;
import app.accountbook.ledger.Ledger;
import app.accountbook.ledger.LedgerAccess;
import app.accountbook.ledger.LedgerRepository;
import app.accountbook.transaction.TransactionCommand.Entry;
import app.accountbook.transaction.TransactionCommand.Transfer;
import app.accountbook.transaction.TransactionView.Line;
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
import java.util.UUID;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * 거래 쓰기(생성·수정·취소·삭제·복원)와 조회. 모든 쓰기는 change_log에 1행을 남긴다.
 * 수정 계열은 version이 맞을 때만 조건부 UPDATE로 반영하고, 아니면 아무것도 바꾸지 않는다.
 */
@Service
public class TransactionService {

    static final int PAYEE_MAX_LENGTH = 100;
    static final int MEMO_MAX_LENGTH = 500;

    private final TransactionRepository transactionRepository;
    private final ChangeLogRepository changeLogRepository;
    private final AccountRepository accountRepository;
    private final CategoryRepository categoryRepository;
    private final CategoryService categoryService;
    private final LedgerAccess ledgerAccess;
    private final LedgerRepository ledgerRepository;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    TransactionService(TransactionRepository transactionRepository, ChangeLogRepository changeLogRepository,
                       AccountRepository accountRepository, CategoryRepository categoryRepository,
                       CategoryService categoryService, LedgerAccess ledgerAccess,
                       LedgerRepository ledgerRepository, ObjectMapper objectMapper, Clock clock) {
        this.transactionRepository = transactionRepository;
        this.changeLogRepository = changeLogRepository;
        this.accountRepository = accountRepository;
        this.categoryRepository = categoryRepository;
        this.categoryService = categoryService;
        this.ledgerAccess = ledgerAccess;
        this.ledgerRepository = ledgerRepository;
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    /** {@link #createOrReplay}와 같고, 새로 만들었는지 알 필요가 없을 때 쓴다. */
    @Transactional
    public TransactionView create(UUID actorId, UUID ledgerId, TransactionCommand cmd, String deviceId) {
        return createOrReplay(actorId, ledgerId, cmd, deviceId).transaction();
    }

    /**
     * 거래를 만든다. id는 클라이언트 값이다. 같은 id의 거래가 이미 있으면(휴지통에 있는 것 포함) 새로 만들지 않고
     * 재전송으로 답하거나 {@link IdConflictException}으로 거부한다(판정은 {@link #replay}).
     * 재전송은 아무것도 바꾸지 않고 이력도 남기지 않는다.
     *
     * <p>검사 순서(ADR 006 결정 4): 구성원 → 형식 검증 → 같은 id 조회 → 참조 검증 → 저장.
     * 이미 저장된 거래의 재전송이 그사이 없어진 계좌나 카테고리 때문에 거부되지 않게 한다.
     */
    @Transactional
    public CreateResult createOrReplay(UUID actorId, UUID ledgerId, TransactionCommand cmd, String deviceId) {
        ledgerAccess.requireMember(actorId, ledgerId);
        Content content = normalize(ledgerId, cmd, actorId);
        Optional<Transaction> existing = transactionRepository.findById(content.id());
        if (existing.isPresent()) {
            return new CreateResult(replay(existing.get(), actorId, ledgerId, content), false);
        }
        requireReferences(ledgerId, cmd);
        Transaction tx = Transaction.of(content.id(), ledgerId, content.type(), content.occurredOn(),
                content.occurredTime(), content.payee(), content.memo(), actorId, content.paidBy());
        content.lines().forEach(line -> tx.addLine(line.accountId(), line.categoryId(), line.amount()));
        transactionRepository.save(tx);
        TransactionView after = TransactionView.of(tx);
        appendLog(tx, ChangeAction.CREATE, actorId, deviceId, null, after);
        return new CreateResult(after, true);
    }

    /** 내용과 라인을 통째로 바꾼다. 거래 종류는 바꿀 수 없다. paidBy가 null이면 기존 값을 유지한다. */
    @Transactional
    public TransactionView update(UUID actorId, UUID txId, long expectedVersion, TransactionCommand cmd,
                                  String deviceId) {
        Transaction tx = loadAccessible(actorId, txId);
        requireVersion(tx, expectedVersion);
        requireNotDeleted(tx, "삭제된 거래는 수정할 수 없습니다.");
        Content content = normalize(tx.getLedgerId(), cmd, tx.getPaidBy());
        requireReferences(tx.getLedgerId(), cmd);
        if (!tx.getId().equals(content.id())) {
            throw new InvalidRequestException("요청의 거래 id가 수정 대상과 다릅니다.");
        }
        if (content.type() != tx.getType()) {
            throw new InvalidRequestException("거래 종류는 바꿀 수 없습니다.");
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
        requireVersion(tx, expectedVersion);
        requireNotDeleted(tx, "삭제된 거래는 취소할 수 없습니다.");
        if (tx.getStatus() == TransactionStatus.CANCELED) {
            throw new InvalidRequestException("이미 취소된 거래입니다.");
        }
        return write(tx, expectedVersion, ChangeAction.CANCEL, actorId, deviceId, now -> tx.cancel());
    }

    /** 소프트 삭제(휴지통으로). */
    @Transactional
    public TransactionView delete(UUID actorId, UUID txId, long expectedVersion, String deviceId) {
        Transaction tx = loadAccessible(actorId, txId);
        requireVersion(tx, expectedVersion);
        requireNotDeleted(tx, "이미 삭제된 거래입니다.");
        return write(tx, expectedVersion, ChangeAction.DELETE, actorId, deviceId, tx::markDeleted);
    }

    /** 휴지통에서 되살린다. 삭제된 거래에만 된다. */
    @Transactional
    public TransactionView restore(UUID actorId, UUID txId, long expectedVersion, String deviceId) {
        Transaction tx = loadAccessible(actorId, txId);
        requireVersion(tx, expectedVersion);
        if (!tx.isDeleted()) {
            throw new InvalidRequestException("삭제된 거래만 복원할 수 있습니다.");
        }
        return write(tx, expectedVersion, ChangeAction.RESTORE, actorId, deviceId, now -> tx.restore());
    }

    /** 삭제된 거래도 돌려준다(deleted=true). */
    @Transactional(readOnly = true)
    public TransactionView get(UUID actorId, UUID txId) {
        return TransactionView.of(loadAccessible(actorId, txId));
    }

    /** 휴지통: 최근에 지운 순. */
    @Transactional(readOnly = true)
    public List<TransactionView> listDeleted(UUID actorId, UUID ledgerId) {
        ledgerAccess.requireMember(actorId, ledgerId);
        return transactionRepository.findByLedgerIdAndDeletedAtIsNotNullOrderByDeletedAtDesc(ledgerId).stream()
                .map(TransactionView::of)
                .toList();
    }

    /** 거래의 변경 이력, 오래된 순. */
    @Transactional(readOnly = true)
    public List<ChangeLogView> history(UUID actorId, UUID txId) {
        Transaction tx = loadAccessible(actorId, txId);
        return changeLogRepository.findByTransactionIdOrderByCreatedAtAsc(tx.getId()).stream()
                .map(ChangeLogView::of)
                .toList();
    }

    /**
     * 같은 id의 거래가 있을 때의 판정(ADR 006 결정 3). 재전송이면 그 거래의 지금 내용을 돌려준다.
     * 만든 뒤 고쳐졌으면(version 2 이상) 내용을 비교하지 않는다. 다른 기기가 고친 뒤의 재전송이 충돌로 보이지 않게 한다.
     */
    private static TransactionView replay(Transaction existing, UUID actorId, UUID ledgerId, Content requested) {
        if (!existing.getLedgerId().equals(ledgerId) || !actorId.equals(existing.getCreatedBy())) {
            throw IdConflictException.unusableId();
        }
        TransactionView current = TransactionView.of(existing);
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
        TransactionView before = TransactionView.of(tx);
        Instant now = Times.now();
        if (transactionRepository.advanceVersion(tx.getId(), expectedVersion, now) == 0) {
            throw new StaleVersionException();
        }
        tx.applyVersion(expectedVersion + 1, now);
        change.accept(now);
        TransactionView after = TransactionView.of(tx);
        appendLog(tx, action, actorId, deviceId, before, after);
        return after;
    }

    private void appendLog(Transaction tx, ChangeAction action, UUID actorId, String deviceId,
                           TransactionView before, TransactionView after) {
        changeLogRepository.save(ChangeLog.of(tx.getId(), tx.getLedgerId(), action, actorId, deviceId,
                toJson(before), toJson(after), nextLogTime(tx.getId())));
    }

    /**
     * 이력 시각은 거래마다 엄격히 증가하게 한다. 같은 마이크로초에 두 번 쓰이거나 시계가 뒤로 가도
     * created_at 순서가 쓰기 순서와 같아야 "오래된 순" 조회가 맞다.
     */
    private Instant nextLogTime(UUID txId) {
        Instant now = Times.now();
        return changeLogRepository.findFirstByTransactionIdOrderByCreatedAtDesc(txId)
                .map(ChangeLog::getCreatedAt)
                .filter(last -> !now.isAfter(last))
                .map(last -> last.plus(1, ChronoUnit.MICROS))
                .orElse(now);
    }

    private JsonNode toJson(TransactionView view) {
        return view == null ? null : objectMapper.valueToTree(view);
    }

    /** 없는 거래와 구성원이 아닌 장부의 거래를 구분하지 않는다. */
    private Transaction loadAccessible(UUID actorId, UUID txId) {
        return Optional.ofNullable(txId)
                .flatMap(transactionRepository::findById)
                .filter(tx -> ledgerAccess.isMember(actorId, tx.getLedgerId()))
                .orElseThrow(NotFoundException::new);
    }

    /** 상태 확인이 호출자가 본 바로 그 version에 대해 이뤄지도록 먼저 비교한다. 동시성은 조건부 UPDATE가 막는다. */
    private static void requireVersion(Transaction tx, long expectedVersion) {
        if (tx.getVersion() != expectedVersion) {
            throw new StaleVersionException();
        }
    }

    private static void requireNotDeleted(Transaction tx, String message) {
        if (tx.isDeleted()) {
            throw new InvalidRequestException(message);
        }
    }

    /**
     * 형식 검증(필수 항목, 형식, 범위)과 비교 전의 값 맞추기. 계좌와 카테고리가 장부에 있는지는 보지 않는다.
     * 돌려주는 값은 저장할 내용이고 재전송 비교에도 쓴다.
     */
    private Content normalize(UUID ledgerId, TransactionCommand cmd, UUID defaultPaidBy) {
        return switch (cmd) {
            case null -> throw new InvalidRequestException("거래 정보가 없습니다.");
            case Entry entry -> normalizeEntry(ledgerId, entry, defaultPaidBy);
            case Transfer transfer -> normalizeTransfer(ledgerId, transfer);
        };
    }

    /** 라인 부호: 지출 -amount, 환불(지출) +amount, 수입 +amount. 카테고리가 없으면 미분류. */
    private Content normalizeEntry(UUID ledgerId, Entry entry, UUID defaultPaidBy) {
        requireHeader(entry.id(), entry.occurredOn());
        requireDateInRange(ledgerId, entry.occurredOn());
        if (entry.type() != TransactionType.EXPENSE && entry.type() != TransactionType.INCOME) {
            throw new InvalidRequestException("지출 또는 수입만 입력할 수 있습니다.");
        }
        TransactionLimits.requireAmountInRange(entry.amount());
        if (entry.refund() && entry.type() == TransactionType.INCOME) {
            throw new InvalidRequestException("환불은 지출에만 표시할 수 있습니다.");
        }
        requireMaxLength(entry.payee(), PAYEE_MAX_LENGTH, "가맹점/내용");
        requireMaxLength(entry.memo(), MEMO_MAX_LENGTH, "메모");
        requireAccountGiven(entry.accountId());
        UUID categoryId = entry.categoryId() == null
                ? categoryService.uncategorized(ledgerId, categoryKind(entry)).getId()
                : entry.categoryId();
        UUID paidBy = entry.paidBy() == null ? defaultPaidBy : entry.paidBy();
        boolean increasesBalance = entry.type() == TransactionType.INCOME || entry.refund();
        long amount = increasesBalance ? entry.amount() : -entry.amount();
        return new Content(entry.id(), entry.type(), entry.occurredOn(),
                Transaction.storableTime(entry.occurredTime()), entry.payee(), entry.memo(), paidBy,
                List.of(new Line(entry.accountId(), categoryId, amount)));
    }

    /** 이체: from 라인 -amount, to 라인 +amount. 카테고리·paidBy·payee가 없다. */
    private Content normalizeTransfer(UUID ledgerId, Transfer transfer) {
        requireHeader(transfer.id(), transfer.occurredOn());
        requireDateInRange(ledgerId, transfer.occurredOn());
        TransactionLimits.requireAmountInRange(transfer.amount());
        requireMaxLength(transfer.memo(), MEMO_MAX_LENGTH, "메모");
        requireAccountGiven(transfer.fromAccountId());
        requireAccountGiven(transfer.toAccountId());
        if (transfer.fromAccountId().equals(transfer.toAccountId())) {
            throw new InvalidRequestException("같은 계좌로는 이체할 수 없습니다.");
        }
        return new Content(transfer.id(), TransactionType.TRANSFER, transfer.occurredOn(),
                Transaction.storableTime(transfer.occurredTime()), null, transfer.memo(), null,
                List.of(new Line(transfer.fromAccountId(), null, -transfer.amount()),
                        new Line(transfer.toAccountId(), null, transfer.amount())));
    }

    /**
     * 참조 검증: 계좌와 카테고리가 이 장부에 있는지, 카테고리의 수입·지출 구분이 맞는지, 결제한 사람이 구성원인지.
     * {@link #normalize}를 통과한 요청에만 쓴다.
     */
    private void requireReferences(UUID ledgerId, TransactionCommand cmd) {
        switch (cmd) {
            case Entry entry -> {
                requireAccountInLedger(ledgerId, entry.accountId());
                if (entry.categoryId() != null) {
                    requireCategoryInLedger(ledgerId, categoryKind(entry), entry.categoryId());
                }
                if (entry.paidBy() != null) {
                    requirePayer(ledgerId, entry.paidBy());
                }
            }
            case Transfer transfer -> {
                requireAccountInLedger(ledgerId, transfer.fromAccountId());
                requireAccountInLedger(ledgerId, transfer.toAccountId());
            }
        }
    }

    private static CategoryKind categoryKind(Entry entry) {
        return entry.type() == TransactionType.EXPENSE ? CategoryKind.EXPENSE : CategoryKind.INCOME;
    }

    private static void requireAccountGiven(UUID accountId) {
        if (accountId == null) {
            throw new InvalidRequestException("계좌가 없습니다.");
        }
    }

    private static void requireHeader(UUID id, LocalDate occurredOn) {
        if (id == null) {
            throw new InvalidRequestException("거래 id가 없습니다.");
        }
        if (occurredOn == null) {
            throw new InvalidRequestException("거래 날짜가 없습니다.");
        }
    }

    /** "오늘"은 서버 시계의 지금을 그 장부의 시간대로 본 날짜다(P-202). */
    private void requireDateInRange(UUID ledgerId, LocalDate occurredOn) {
        ZoneId ledgerZone = ledgerRepository.findById(ledgerId)
                .map(Ledger::getTimezone)
                .map(ZoneId::of)
                .orElseThrow(NotFoundException::new);
        TransactionLimits.requireDateInRange(occurredOn, clock, ledgerZone);
    }

    private static void requireMaxLength(String text, int maxLength, String label) {
        if (text != null && text.codePointCount(0, text.length()) > maxLength) {
            throw new InvalidRequestException(label + "은(는) " + maxLength + "자까지 쓸 수 있습니다.");
        }
    }

    private void requireAccountInLedger(UUID ledgerId, UUID accountId) {
        boolean inLedger = accountRepository.findById(accountId)
                .map(Account::getLedgerId)
                .filter(ledgerId::equals)
                .isPresent();
        if (!inLedger) {
            throw new InvalidRequestException("장부에 없는 계좌입니다.");
        }
    }

    private void requireCategoryInLedger(UUID ledgerId, CategoryKind kind, UUID categoryId) {
        Category category = categoryRepository.findById(categoryId)
                .filter(candidate -> candidate.getLedgerId().equals(ledgerId))
                .orElseThrow(() -> new InvalidRequestException("장부에 없는 카테고리입니다."));
        if (category.getKind() != kind) {
            throw new InvalidRequestException("거래 종류와 카테고리의 수입·지출 구분이 다릅니다.");
        }
    }

    private void requirePayer(UUID ledgerId, UUID paidBy) {
        if (!ledgerAccess.isMember(paidBy, ledgerId)) {
            throw new InvalidRequestException("결제한 사람은 장부 구성원이어야 합니다.");
        }
    }

    /** 형식 검증을 지난 요청의 저장 내용. 재전송 비교에도 쓴다. */
    private record Content(UUID id, TransactionType type, LocalDate occurredOn, LocalTime occurredTime,
                           String payee, String memo, UUID paidBy, List<Line> lines) {

        static Content of(Transaction tx) {
            return new Content(tx.getId(), tx.getType(), tx.getOccurredOn(), tx.getOccurredTime(), tx.getPayee(),
                    tx.getMemo(), tx.getPaidBy(), tx.getLines().stream().map(Line::of).toList());
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
