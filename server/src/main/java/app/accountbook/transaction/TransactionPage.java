package app.accountbook.transaction;

import java.time.LocalDate;
import java.util.List;

/**
 * 거래 목록의 한 쪽(#15). 합계는 P-205다: 이체·취소·휴지통 거래를 빼고 승인 대기 거래를 넣으며, 지출은 양수로 센다
 * (환불은 지출을 줄인다).
 *
 * @param next   다음 쪽이 있으면 이 쪽 마지막 거래의 키, 이 쪽이 마지막이면 null
 * @param totals 범위(달 또는 하루) 전체의 합계. 첫 쪽에만 있고, 다음 쪽과 장부 전체 모드에서는 null
 * @param days   이 쪽에 나온 날마다 그날 전체의 합계. 날짜 역순이고 거래가 없는 날은 없다
 */
public record TransactionPage(List<TransactionView> items, TransactionKey next, Totals totals, List<DayTotals> days) {

    public TransactionPage {
        items = List.copyOf(items);
        days = List.copyOf(days);
    }

    public record Totals(long income, long expense) {
    }

    public record DayTotals(LocalDate date, long income, long expense) {
    }
}
