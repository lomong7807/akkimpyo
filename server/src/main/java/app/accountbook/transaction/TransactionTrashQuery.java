package app.accountbook.transaction;

import app.accountbook.ledger.LedgerAccess;
import jakarta.persistence.EntityManager;
import jakarta.persistence.TypedQuery;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 휴지통(F-229, P-215, #47). 그 장부에서 휴지통에 넣었고 아직 완전히 지우지 않은 거래만 준다. 순서는 {@link TrashPage.Key}이고,
 * 다음 쪽은 OFFSET이 아니라 앞 쪽 마지막 거래의 키 뒤부터라 그사이 되살리거나 새로 지워도 받은 거래가 다시 오지 않는다.
 *
 * <p>거래와 라인은 {@link TransactionListQuery}처럼 한 문장으로 읽는다(하위 질의가 쪽을 자른다). 장부 조건은 두 질의의 거래에
 * 건다. 장부의 거래는 {@code ix_transaction_ledger_occurred_on}으로 찾고 휴지통 조건과 순서는 그 뒤에 본다(새 인덱스 없음, #47).
 */
@Component
@Transactional(readOnly = true)
public class TransactionTrashQuery {

    /** 한 쪽의 건수(P-232). */
    public static final int PAGE_SIZE = 50;

    /** %s는 다음 쪽 조건이다. 하위 질의(자르기)와 바깥 질의(내보내기)의 정렬이 같다. */
    private static final String PAGE = """
            select t from Transaction t left join fetch t.lines
             where t.ledgerId = :ledgerId
               and t.id in (select p.id from Transaction p
                             where p.ledgerId = :ledgerId
                               and p.deletedAt is not null%s
                             order by p.deletedAt desc, p.id desc
                             limit :size)
             order by t.deletedAt desc, t.id desc
            """;

    /** 키의 뒤: 더 이르게 지운 거래, 또는 같은 시각에 지운 거래 가운데 더 작은 id. */
    private static final String AFTER = " and p.deletedAt <= :afterAt"
            + " and (p.deletedAt < :afterAt or p.id < :afterId)";

    private final EntityManager entityManager;
    private final LedgerAccess ledgerAccess;

    TransactionTrashQuery(EntityManager entityManager, LedgerAccess ledgerAccess) {
        this.entityManager = entityManager;
        this.ledgerAccess = ledgerAccess;
    }

    /**
     * 한 쪽({@value #PAGE_SIZE}건). 휴지통에 넣은 시각이 늦은 것부터다.
     *
     * @param after 앞 쪽의 {@link TrashPage#next()}. 첫 쪽이면 null
     */
    public TrashPage page(UUID actorId, UUID ledgerId, TrashPage.Key after) {
        ledgerAccess.requireMember(actorId, ledgerId);
        TypedQuery<Transaction> query = entityManager.createQuery(PAGE.formatted(after == null ? "" : AFTER),
                        Transaction.class)
                .setParameter("ledgerId", ledgerId)
                .setParameter("size", PAGE_SIZE + 1);
        if (after != null) {
            query.setParameter("afterAt", after.deletedAt()).setParameter("afterId", after.id());
        }
        // 라인을 함께 읽어 거래 하나가 라인 수만큼의 행으로 온다. 같은 거래는 같은 객체다.
        List<Transaction> found = query.getResultList().stream().distinct().toList();
        List<TransactionView> items = TransactionViews.of(entityManager,
                found.subList(0, Math.min(PAGE_SIZE, found.size())));
        return new TrashPage(items, found.size() > PAGE_SIZE ? TrashPage.Key.of(items.getLast()) : null);
    }
}
