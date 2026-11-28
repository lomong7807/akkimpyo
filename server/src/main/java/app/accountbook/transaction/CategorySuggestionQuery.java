package app.accountbook.transaction;

import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.UserText;
import app.accountbook.ledger.LedgerAccess;
import jakarta.persistence.EntityManager;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 가맹점별 최근 카테고리 제안(P-219, F-201, F-211, #61 응답 계약). 같은 장부의 지출(수입·이체 제외) 가운데 같은 가맹점으로
 * 저장한 시각({@code created_at})이 가장 늦은 거래의 카테고리다. 휴지통의 거래는 빼고 취소한 거래는 넣는다(ledger 결정
 * 2026-11-24, #102). 저장한 시각이 같으면 id가 큰 거래다. 제안만 하고 거래를 바꾸지 않는다.
 *
 * <p>같은 가맹점: 요청 값을 거래를 저장할 때와 같이 맞추고({@link UserText#payee}), 저장된 값(V18로 이미 맞춘 값)과 함께
 * 공백류({@link UserText#TRIMMED_SPACES})를 모두 뺀 뒤 대소문자를 무시해 비교한다(P-219). 대소문자는 양쪽 모두 DB의
 * {@code lower}로 바꾼다. 한쪽만 Java로 바꾸면 DB 로캘에 따라 어긋날 수 있다.
 *
 * <p>카테고리는 그 거래가 지금 가리키는 것이다. 라인이 가리키는 카테고리는 지울 수 없고(복합 FK, CategoryService.delete),
 * 지울 때는 거래를 옮기므로(P-222) 지운 카테고리를 주지 않는다.
 *
 * <p>읽는 양: 거래는 장부 조건으로 그 장부의 것만 읽지만, 맞춘 가맹점으로 찾는 인덱스가 없어 장부의 거래를 모두 읽는다.
 * 라인은 고른 거래의 것만 거래 id로 찾는다(CategorySuggestionPlanTest).
 */
@Component
@Transactional(readOnly = true)
public class CategorySuggestionQuery {

    /** {@code :spaces}는 {@link UserText#TRIMMED_SPACES}다. 지출의 라인은 하나다. */
    static final String LATEST = """
            select l.category_id
              from transaction_line l
             where l.ledger_id = :ledgerId
               and l.transaction_id = (select t.id
                                         from transaction t
                                        where t.ledger_id = :ledgerId
                                          and t.type = 'EXPENSE'
                                          and t.deleted_at is null
                                          and lower(translate(t.payee, :spaces, ''))
                                              = lower(translate(:payee, :spaces, ''))
                                        order by t.created_at desc, t.id desc
                                        limit 1)
            """;

    private final EntityManager entityManager;
    private final LedgerAccess ledgerAccess;

    CategorySuggestionQuery(EntityManager entityManager, LedgerAccess ledgerAccess) {
        this.entityManager = entityManager;
        this.ledgerAccess = ledgerAccess;
    }

    /**
     * 구성원 확인이 가맹점 검사보다 먼저다.
     *
     * @param payee 가맹점/내용. 없거나 비었거나 공백류뿐이면 제안이 없다. 100자를 넘거나 쓸 수 없는 글자가 있으면 거래를
     *              저장할 때와 같은 {@code payee}의 {@link InvalidRequestException}이다(P-214)
     * @return 제안할 카테고리. 없으면 빈 값이고 화면이 미분류로 둔다
     */
    public Optional<UUID> suggest(UUID actorId, UUID ledgerId, String payee) {
        ledgerAccess.requireMember(actorId, ledgerId);
        String normalized = UserText.payee(payee, TransactionService.PAYEE_MAX_LENGTH);
        if (normalized == null) {
            return Optional.empty();
        }
        List<?> found = entityManager.createNativeQuery(LATEST)
                .setParameter("ledgerId", ledgerId)
                .setParameter("spaces", UserText.TRIMMED_SPACES)
                .setParameter("payee", normalized)
                .getResultList();
        return found.stream().findFirst().map(UUID.class::cast);
    }
}
