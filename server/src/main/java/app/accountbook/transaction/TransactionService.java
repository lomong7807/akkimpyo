package app.accountbook.transaction;

import app.accountbook.account.Account;
import app.accountbook.account.AccountRepository;
import app.accountbook.category.Category;
import app.accountbook.category.CategoryKind;
import app.accountbook.category.CategoryRepository;
import app.accountbook.category.CategoryService;
import app.accountbook.common.IdConflictException;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.NotFoundException;
import app.accountbook.common.StaleVersionException;
import app.accountbook.common.Times;
import app.accountbook.ledger.LedgerAccess;
import app.accountbook.transaction.TransactionCommand.Entry;
import app.accountbook.transaction.TransactionCommand.Transfer;
import app.accountbook.transaction.TransactionView.Line;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
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
    private final ObjectMapper objectMapper;

    TransactionService(TransactionRepository transactionRepository, ChangeLogRepository changeLogRepository,
                       AccountRepository accountRepository, CategoryRepository categoryRepository,
                       CategoryService categoryService, LedgerAccess ledgerAccess, ObjectMapper objectMapper) {
        this.transactionRepository = transactionRepository;
        this.changeLogRepository = changeLogRepository;
        this.accountRepository = accountRepository;
        this.categoryRepository = categoryRepository;
        this.categoryService = categoryService;
        this.ledgerAccess = ledgerAccess;
        this.objectMapper = objectMapper;
    }

    /**
     * 거래를 만든다. id는 클라이언트 값이다. 같은 id가 이미 있으면(삭제된 것 포함) 같은 장부·같은 내용일 때
     * 저장된 거래를 그대로 돌려주고(이력 추가 없음), 아니면 {@link IdConflictException}.
     */
    @Transactional
    public TransactionView create(UUID actorId, UUID ledgerId, TransactionCommand cmd, String deviceId) {
        ledgerAccess.requireMember(actorId, ledgerId);
        Content content = resolve(ledgerId, cmd, actorId);
        Optional<Transaction> existing = transactionRepository.findById(content.id());
        if (existing.isPresent()) {
            return replay(existing.get(), ledgerId, content);
        }
        Transaction tx = Transaction.of(content.id(), ledgerId, content.type(), content.occurredOn(),
                content.occurredTime(), content.payee(), content.memo(), actorId, content.paidBy());
        content.lines().forEach(line -> tx.addLine(line.accountId(), line.categoryId(), line.amount()));
        transactionRepository.save(tx);
        TransactionView after = TransactionView.of(tx);
        appendLog(tx, ChangeAction.CREATE, actorId, deviceId, null, after);
        return after;
    }

    /** 내용과 라인을 통째로 바꾼다. 거래 종류는 바꿀 수 없다. paidBy가 null이면 기존 값을 유지한다. */
    @Transactional
    public TransactionView update(UUID actorId, UUID txId, long expectedVersion, TransactionCommand cmd,
                                  String deviceId) {
        Transaction tx = loadAccessible(actorId, txId);
        requireVersion(tx, expectedVersion);
        requireNotDeleted(tx, "삭제된 거래는 수정할 수 없습니다.");
        Content content = resolve(tx.getLedgerId(), cmd, tx.getPaidBy());
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

    private static TransactionView replay(Transaction existing, UUID ledgerId, Content requested) {
        if (!existing.getLedgerId().equals(ledgerId) || !Content.of(existing).sameAs(requested)) {
            throw new IdConflictException();
        }
        return TransactionView.of(existing);
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

    private Content resolve(UUID ledgerId, TransactionCommand cmd, UUID defaultPaidBy) {
        return switch (cmd) {
            case null -> throw new InvalidRequestException("거래 정보가 없습니다.");
            case Entry entry -> resolveEntry(ledgerId, entry, defaultPaidBy);
            case Transfer transfer -> resolveTransfer(ledgerId, transfer);
        };
    }

    /** 라인 부호: 지출 -amount, 환불(지출) +amount, 수입 +amount. 카테고리가 없으면 미분류. */
    private Content resolveEntry(UUID ledgerId, Entry entry, UUID defaultPaidBy) {
        requireHeader(entry.id(), entry.occurredOn());
        if (entry.type() != TransactionType.EXPENSE && entry.type() != TransactionType.INCOME) {
            throw new InvalidRequestException("지출 또는 수입만 입력할 수 있습니다.");
        }
        requirePositive(entry.amount());
        if (entry.refund() && entry.type() == TransactionType.INCOME) {
            throw new InvalidRequestException("환불은 지출에만 표시할 수 있습니다.");
        }
        requireMaxLength(entry.payee(), PAYEE_MAX_LENGTH, "가맹점/내용");
        requireMaxLength(entry.memo(), MEMO_MAX_LENGTH, "메모");
        requireAccountInLedger(ledgerId, entry.accountId());
        CategoryKind kind = entry.type() == TransactionType.EXPENSE ? CategoryKind.EXPENSE : CategoryKind.INCOME;
        UUID categoryId = entry.categoryId() == null
                ? categoryService.uncategorized(ledgerId, kind).getId()
                : requireCategoryInLedger(ledgerId, kind, entry.categoryId());
        UUID paidBy = entry.paidBy() == null ? defaultPaidBy : requirePayer(ledgerId, entry.paidBy());
        boolean increasesBalance = entry.type() == TransactionType.INCOME || entry.refund();
        long amount = increasesBalance ? entry.amount() : -entry.amount();
        return new Content(entry.id(), entry.type(), entry.occurredOn(),
                Transaction.storableTime(entry.occurredTime()), entry.payee(), entry.memo(), paidBy,
                List.of(new Line(entry.accountId(), categoryId, amount)));
    }

    /** 이체: from 라인 -amount, to 라인 +amount. 카테고리·paidBy·payee가 없다. */
    private Content resolveTransfer(UUID ledgerId, Transfer transfer) {
        requireHeader(transfer.id(), transfer.occurredOn());
        requirePositive(transfer.amount());
        requireMaxLength(transfer.memo(), MEMO_MAX_LENGTH, "메모");
        requireAccountInLedger(ledgerId, transfer.fromAccountId());
        requireAccountInLedger(ledgerId, transfer.toAccountId());
        if (transfer.fromAccountId().equals(transfer.toAccountId())) {
            throw new InvalidRequestException("같은 계좌로는 이체할 수 없습니다.");
        }
        return new Content(transfer.id(), TransactionType.TRANSFER, transfer.occurredOn(),
                Transaction.storableTime(transfer.occurredTime()), null, transfer.memo(), null,
                List.of(new Line(transfer.fromAccountId(), null, -transfer.amount()),
                        new Line(transfer.toAccountId(), null, transfer.amount())));
    }

    private static void requireHeader(UUID id, LocalDate occurredOn) {
        if (id == null) {
            throw new InvalidRequestException("거래 id가 없습니다.");
        }
        if (occurredOn == null) {
            throw new InvalidRequestException("거래 날짜가 없습니다.");
        }
    }

    private static void requirePositive(long amount) {
        if (amount <= 0) {
            throw new InvalidRequestException("금액은 0보다 커야 합니다.");
        }
    }

    private static void requireMaxLength(String text, int maxLength, String label) {
        if (text != null && text.codePointCount(0, text.length()) > maxLength) {
            throw new InvalidRequestException(label + "은(는) " + maxLength + "자까지 쓸 수 있습니다.");
        }
    }

    private void requireAccountInLedger(UUID ledgerId, UUID accountId) {
        boolean inLedger = accountId != null && accountRepository.findById(accountId)
                .map(Account::getLedgerId)
                .filter(ledgerId::equals)
                .isPresent();
        if (!inLedger) {
            throw new InvalidRequestException("장부에 없는 계좌입니다.");
        }
    }

    private UUID requireCategoryInLedger(UUID ledgerId, CategoryKind kind, UUID categoryId) {
        Category category = categoryRepository.findById(categoryId)
                .filter(candidate -> candidate.getLedgerId().equals(ledgerId))
                .orElseThrow(() -> new InvalidRequestException("장부에 없는 카테고리입니다."));
        if (category.getKind() != kind) {
            throw new InvalidRequestException("거래 종류와 카테고리의 수입·지출 구분이 다릅니다.");
        }
        return category.getId();
    }

    private UUID requirePayer(UUID ledgerId, UUID paidBy) {
        if (!ledgerAccess.isMember(paidBy, ledgerId)) {
            throw new InvalidRequestException("결제한 사람은 장부 구성원이어야 합니다.");
        }
        return paidBy;
    }

    /** 요청을 검증·해석한 저장 내용. 재전송 비교에도 쓴다. */
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
