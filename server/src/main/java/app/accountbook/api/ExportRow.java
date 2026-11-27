package app.accountbook.api;

import app.accountbook.category.Category;
import app.accountbook.transaction.ExportedTransaction;
import app.accountbook.transaction.TransactionStatus;
import app.accountbook.transaction.TransactionType;
import app.accountbook.transaction.TransactionView.Line;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.IntStream;

/**
 * 내보내기 파일의 한 행(F-701 열 구성, #57). 파일 형식은 모른다. 지출·수입은 라인마다 한 행이고, 이체는 한 행에 보내는 계좌
 * (계좌 열)와 받는 계좌를 쓴다. 금액은 늘 양의 정수(원)이고 방향은 유형과 환불 구분으로 나타낸다. 이름은 api가 읽은 지금 값이고
 * 그사이 지워졌거나 탈퇴한 사람이면 비운다. 값이 없는 칸은 {@code null}이다.
 *
 * @param number 거래 번호. 이 파일 안에서 거래마다 1부터 매기고 한 거래의 행은 같은 번호다(F-701의 분할 거래, 3단계)
 */
record ExportRow(LocalDate date, LocalTime time, String type, long amount, String refund, String account,
                 String toAccount, String topCategory, String subCategory, String payee, String memo, String status,
                 String author, int number) {

    /** F-701의 열 순서. 마지막은 F-701이 분할 거래를 위해 따로 둔 거래 번호 열이다. */
    static final List<String> HEADER = List.of("날짜", "시각", "유형", "금액", "환불·돌려받음 구분", "계좌", "받는 계좌",
            "상위 카테고리", "하위 카테고리", "가맹점/내용", "메모", "결제한 사람", "상태", "미확인 여부", "이벤트", "작성자",
            "거래 번호");

    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm");
    private static final Map<TransactionType, String> TYPES = Map.of(
            TransactionType.EXPENSE, "지출", TransactionType.INCOME, "수입", TransactionType.TRANSFER, "이체");
    /** 내부 용어 표(기능정의서 1.4)의 한글 이름. */
    private static final Map<TransactionStatus, String> STATUSES = Map.of(
            TransactionStatus.PENDING, "승인 대기", TransactionStatus.POSTED, "완료", TransactionStatus.CANCELED, "취소");
    /** 1단계의 환불은 지출 입력의 "환불"뿐이다(P-209). 돌려받음(P-210)은 아직 저장하지 않는다(#46). */
    private static final String REFUND = "환불";

    static List<ExportRow> of(List<ExportedTransaction> transactions, Names names) {
        return IntStream.range(0, transactions.size()).boxed()
                .flatMap(index -> of(transactions.get(index), index + 1, names).stream())
                .toList();
    }

    private static List<ExportRow> of(ExportedTransaction tx, int number, Names names) {
        if (tx.type() == TransactionType.TRANSFER) {
            // 받는 계좌는 잔액이 늘어 양수, 보내는 계좌는 음수다(P-203).
            Line to = tx.lines().stream().filter(line -> line.amount() > 0).findFirst().orElseThrow();
            Line from = tx.lines().stream().filter(line -> line.amount() < 0).findFirst().orElseThrow();
            return List.of(row(tx, number, names, to.amount(), null, from.accountId(), to.accountId(), null));
        }
        return tx.lines().stream()
                .map(line -> row(tx, number, names, Math.abs(line.amount()),
                        tx.type() == TransactionType.EXPENSE && line.amount() > 0 ? REFUND : null,
                        line.accountId(), null, find(names.categories(), line.categoryId())))
                .toList();
    }

    /** 최상위 카테고리는 상위 열에, 하위 카테고리는 하위 열에 쓰고 상위 열에 그 부모를 쓴다. */
    private static ExportRow row(ExportedTransaction tx, int number, Names names, long amount, String refund,
                                 UUID accountId, UUID toAccountId, Category category) {
        boolean sub = category != null && category.getParentId() != null;
        Category top = sub ? find(names.categories(), category.getParentId()) : category;
        return new ExportRow(tx.occurredOn(), tx.occurredTime(), TYPES.get(tx.type()), amount, refund,
                find(names.accounts(), accountId), find(names.accounts(), toAccountId),
                top == null ? null : top.getName(), sub ? category.getName() : null, tx.payee(), tx.memo(),
                STATUSES.get(tx.status()), find(names.people(), tx.createdBy()), number);
    }

    /** 없는 id(이체의 카테고리 등)는 빈 칸이다. 바꿀 수 없는 Map은 null 키를 물으면 예외라 먼저 거른다. */
    private static <V> V find(Map<UUID, V> map, UUID id) {
        return id == null ? null : map.get(id);
    }

    /**
     * {@link #HEADER} 순서의 글자. 날짜는 {@code YYYY-MM-DD}, 시각은 {@code HH:mm}이다. 1단계에 값이 없는 열(결제한 사람,
     * 미확인 여부, 이벤트)은 두고 비운다(ledger 결정 2026-11-24, #57).
     */
    List<String> cells() {
        return Arrays.asList(date.toString(), time == null ? null : TIME.format(time), type, Long.toString(amount),
                refund, account, toAccount, topCategory, subCategory, payee, memo, null, status, null, null, author,
                Integer.toString(number));
    }

    /** 행에 붙이는 이름(id → 이름). 카테고리는 상위를 찾으려고 통째로 둔다. api가 각 모듈에서 따로 읽는다(ADR 004 결정 6). */
    record Names(Map<UUID, String> accounts, Map<UUID, Category> categories, Map<UUID, String> people) {
    }
}
