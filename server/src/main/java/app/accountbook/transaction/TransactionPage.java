package app.accountbook.transaction;

import java.util.List;

/**
 * 거래 목록의 한 쪽(#15).
 *
 * @param next 다음 쪽이 있으면 이 쪽 마지막 거래의 키, 이 쪽이 마지막이면 null
 */
public record TransactionPage(List<TransactionView> items, TransactionKey next) {

    public TransactionPage {
        items = List.copyOf(items);
    }
}
