package app.accountbook.transaction;

import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * 휴지통의 한 쪽(F-229, #47). 합계는 없다.
 *
 * @param next 다음 쪽이 있으면 이 쪽 마지막 거래의 키, 이 쪽이 마지막이면 null
 */
public record TrashPage(List<TransactionView> items, Key next) {

    public TrashPage {
        items = List.copyOf(items);
    }

    /**
     * 휴지통에서 거래 하나의 자리. 순서는 휴지통에 넣은 시각↓, 같으면 id↓다. id는 DB의 uuid 순서(바이트 순서)다.
     *
     * @param deletedAt 저장된 시각 그대로(마이크로초까지)
     */
    public record Key(Instant deletedAt, UUID id) {

        public Key {
            Objects.requireNonNull(deletedAt, "deletedAt");
            Objects.requireNonNull(id, "id");
        }

        static Key of(TransactionView tx) {
            return new Key(tx.deletedAt(), tx.id());
        }
    }
}
