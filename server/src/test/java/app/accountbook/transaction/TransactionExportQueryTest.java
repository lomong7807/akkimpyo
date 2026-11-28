package app.accountbook.transaction;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.assertj.core.api.Assertions.catchThrowableOfType;
import static org.assertj.core.api.Assertions.tuple;

import app.accountbook.account.AccountType;
import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.NotLedgerMemberException;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.transaction.TransactionCommand.Entry;
import app.accountbook.transaction.TransactionCommand.Transfer;
import app.accountbook.transaction.TransactionView.Line;
import app.accountbook.user.User;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import jakarta.persistence.EntityManager;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 내보내기가 읽는 거래(F-701, P-228, #57). 기간은 거래의 날짜이고 양 끝 날을 넣는다. 휴지통의 거래는 빼고 취소한 거래는
 * 넣는다. 순서는 오래된 것부터다. 날짜는 입력한 그대로라 시각과 무관하게 날짜로만 자른다(P-202).
 */
@IntegrationTest
class TransactionExportQueryTest {

    private static final String DEVICE = "test-device";
    private static final LocalDate OCT_1 = LocalDate.of(2026, 10, 1);
    private static final LocalDate OCT_31 = LocalDate.of(2026, 10, 31);

    @Autowired TransactionExportQuery exportQuery;
    @Autowired TransactionService transactionService;
    @Autowired Fixtures fixtures;
    @Autowired EntityManager entityManager;

    private User owner;
    private UUID ledgerId;
    private UUID cash;
    private UUID bank;

    @BeforeEach
    void setUp() {
        owner = fixtures.user("export@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
        cash = fixtures.account(owner, ledgerId, "현금", AccountType.CASH, 0, OCT_1).getId();
        bank = fixtures.account(owner, ledgerId, "은행", AccountType.BANK, 0, OCT_1).getId();
    }

    @Test
    void 시작일_0시와_종료일_23시59분은_들고_그_하루_밖은_빠진다_월말() {
        expense(LocalDate.of(2026, 9, 30), LocalTime.of(23, 59));
        UUID first = expense(OCT_1, LocalTime.MIDNIGHT);
        UUID last = expense(OCT_31, LocalTime.of(23, 59));
        expense(LocalDate.of(2026, 11, 1), LocalTime.MIDNIGHT);

        assertThat(ids(OCT_1, OCT_31)).containsExactly(first, last);
    }

    @Test
    void 연말과_연초는_날짜로_나뉘고_하루만_고를_수_있다() {
        UUID december31 = expense(LocalDate.of(2026, 12, 31), LocalTime.of(23, 59));
        UUID january1 = expense(LocalDate.of(2027, 1, 1), LocalTime.MIDNIGHT);

        assertThat(ids(LocalDate.of(2026, 12, 1), LocalDate.of(2026, 12, 31))).containsExactly(december31);
        assertThat(ids(LocalDate.of(2027, 1, 1), LocalDate.of(2027, 1, 1))).containsExactly(january1);
    }

    @Test
    void 휴지통_거래는_빠지고_취소한_거래는_상태와_함께_든다() {
        TransactionView kept = fixtures.expense(owner, ledgerId, cash, null, OCT_1, 1_000);
        TransactionView canceled = fixtures.cancel(owner, fixtures.expense(owner, ledgerId, cash, null, OCT_1, 2_000));
        fixtures.delete(owner, fixtures.expense(owner, ledgerId, cash, null, OCT_1, 3_000));
        fixtures.delete(owner, fixtures.cancel(owner, fixtures.expense(owner, ledgerId, cash, null, OCT_1, 4_000)));

        assertThat(exportQuery.transactions(owner.getId(), ledgerId, OCT_1, OCT_31))
                .extracting(ExportedTransaction::id, ExportedTransaction::status)
                .containsExactlyInAnyOrder(tuple(kept.id(), TransactionStatus.POSTED),
                        tuple(canceled.id(), TransactionStatus.CANCELED));
    }

    @Test
    void 오래된_것부터이고_같은_날은_시각_없는_거래가_먼저며_이체는_두_라인을_담는다() {
        UUID nine = expense(OCT_31, LocalTime.of(9, 0));
        TransactionView transfer = transactionService.create(owner.getId(), ledgerId,
                new Transfer(UUID.randomUUID(), OCT_31, LocalTime.of(8, 0), bank, cash, 50_000, "용돈"), DEVICE);
        UUID untimed = expense(OCT_31, null);
        UUID earlier = expense(OCT_1, LocalTime.of(23, 0));

        List<ExportedTransaction> found = exportQuery.transactions(owner.getId(), ledgerId, OCT_1, OCT_31);

        assertThat(found).extracting(ExportedTransaction::id).containsExactly(earlier, untimed, transfer.id(), nine);
        ExportedTransaction moved = found.get(2);
        assertThat(moved.type()).isEqualTo(TransactionType.TRANSFER);
        assertThat(moved.memo()).isEqualTo("용돈");
        assertThat(moved.createdBy()).isEqualTo(owner.getId());
        assertThat(moved.lines()).containsExactlyInAnyOrder(new Line(bank, null, -50_000), new Line(cash, null, 50_000));
    }

    @Test
    void 다른_장부의_거래는_없다() {
        User other = fixtures.user("export-other@example.com");
        UUID otherLedger = fixtures.personalLedgerId(other);
        UUID otherCash = fixtures.account(other, otherLedger, "현금", AccountType.CASH, 0, OCT_1).getId();
        fixtures.expense(other, otherLedger, otherCash, null, OCT_1, 1_000);

        assertThat(exportQuery.transactions(owner.getId(), ledgerId, OCT_1, OCT_31)).isEmpty();
    }

    /**
     * 장부 전체(#379)는 기간 조건만 없다. 가장 이른 날(P-202의 2000-01-01)도 미래 날짜도 들고, 휴지통 거래는 첫 거래보다 이르거나
     * 마지막 거래보다 늦어도 빠진다. 첫 거래와 마지막 거래의 날짜가 파일 이름의 기간이 된다.
     */
    @Test
    void 장부_전체는_휴지통만_빼고_오래된_것부터이며_다른_장부의_거래는_없다() {
        fixtures.delete(owner, fixtures.expense(owner, ledgerId, cash, null, LocalDate.of(2000, 1, 1), 1_000));
        UUID earliest = expense(LocalDate.of(2000, 1, 2), null);
        UUID middle = expense(OCT_1, LocalTime.of(9, 0));
        UUID latest = fixtures.cancel(owner,
                fixtures.expense(owner, ledgerId, cash, null, LocalDate.of(2027, 1, 1), 2_000)).id();
        fixtures.delete(owner, fixtures.expense(owner, ledgerId, cash, null, LocalDate.of(2027, 1, 2), 3_000));
        User other = fixtures.user("export-other@example.com");
        UUID otherLedger = fixtures.personalLedgerId(other);
        UUID otherCash = fixtures.account(other, otherLedger, "현금", AccountType.CASH, 0, OCT_1).getId();
        fixtures.expense(other, otherLedger, otherCash, null, LocalDate.of(2000, 1, 1), 1_000);

        assertThat(exportQuery.allTransactions(owner.getId(), ledgerId))
                .extracting(ExportedTransaction::id, ExportedTransaction::occurredOn, ExportedTransaction::status)
                .containsExactly(tuple(earliest, LocalDate.of(2000, 1, 2), TransactionStatus.POSTED),
                        tuple(middle, OCT_1, TransactionStatus.POSTED),
                        tuple(latest, LocalDate.of(2027, 1, 1), TransactionStatus.CANCELED));
        assertThat(exportQuery.allTransactions(other.getId(), otherLedger)).hasSize(1);
    }

    @Test
    void 장부_전체도_구성원이_아니면_거부한다() {
        expense(OCT_1, null);
        User stranger = fixtures.user("export-stranger@example.com");

        assertThat(catchThrowable(() -> exportQuery.allTransactions(stranger.getId(), ledgerId)))
                .isInstanceOf(NotLedgerMemberException.class);
    }

    @Test
    void 종료일이_시작일보다_앞이면_to의_NOT_ALLOWED이고_구성원_확인이_먼저다() {
        InvalidRequestException rejected = catchThrowableOfType(InvalidRequestException.class,
                () -> exportQuery.transactions(owner.getId(), ledgerId, OCT_31, OCT_1));
        assertThat(rejected.field()).isEqualTo("to");
        assertThat(rejected.code()).isEqualTo(FieldErrorCode.NOT_ALLOWED);

        User stranger = fixtures.user("export-stranger@example.com");
        assertThat(catchThrowable(() -> exportQuery.transactions(stranger.getId(), ledgerId, OCT_31, OCT_1)))
                .isInstanceOf(NotLedgerMemberException.class);
    }

    /**
     * 거래와 라인을 한 문장으로 읽는다(#57 구조 결정). 거래가 늘어도 문장 수가 같고, 라인을 읽는 문장은 하나다. 장부 전체(#379)도
     * 기간을 정한 조회와 문장 수가 같다(첫·마지막 날짜를 따로 묻지 않는다).
     */
    @Test
    void 거래가_늘어도_문장_수가_같다() {
        expense(OCT_1, null);
        List<String> one = statements(() -> exportQuery.transactions(owner.getId(), ledgerId, OCT_1, OCT_31));
        for (int day = 2; day <= 20; day++) {
            expense(LocalDate.of(2026, 10, day), null);
            fixtures.transfer(owner, ledgerId, bank, cash, LocalDate.of(2026, 10, day), 1_000);
        }

        List<String> many = statements(() -> exportQuery.transactions(owner.getId(), ledgerId, OCT_1, OCT_31));
        assertThat(many).as("거래가 하나일 때 %s", one).hasSameSizeAs(one);
        assertThat(many).filteredOn(sql -> sql.contains("transaction_line")).hasSize(1);
        List<String> whole = statements(() -> exportQuery.allTransactions(owner.getId(), ledgerId));
        assertThat(whole).as("기간을 정했을 때 %s", one).hasSameSizeAs(one);
        assertThat(whole).filteredOn(sql -> sql.contains("transaction_line")).hasSize(1);
    }

    /** 조회 한 번에 Hibernate가 보낸 문장(구성원 확인 포함). 앞서 만든 거래는 먼저 DB에 쓴다. */
    private List<String> statements(Supplier<List<ExportedTransaction>> read) {
        entityManager.flush();
        Logger sqlLog = (Logger) LoggerFactory.getLogger("org.hibernate.SQL");
        Level level = sqlLog.getLevel();
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        sqlLog.addAppender(appender);
        sqlLog.setLevel(Level.DEBUG);
        try {
            assertThat(read.get()).isNotEmpty();
        } finally {
            sqlLog.setLevel(level);
            sqlLog.detachAppender(appender);
        }
        return appender.list.stream().map(ILoggingEvent::getFormattedMessage).toList();
    }

    private UUID expense(LocalDate on, LocalTime at) {
        return transactionService.create(owner.getId(), ledgerId, new Entry(UUID.randomUUID(),
                TransactionType.EXPENSE, on, at, cash, null, 1_000, false, "가맹점", null, null), DEVICE).id();
    }

    private List<UUID> ids(LocalDate from, LocalDate to) {
        return exportQuery.transactions(owner.getId(), ledgerId, from, to).stream().map(ExportedTransaction::id)
                .toList();
    }
}
