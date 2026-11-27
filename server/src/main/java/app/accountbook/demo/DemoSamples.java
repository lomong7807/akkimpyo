package app.accountbook.demo;

import static app.accountbook.transaction.TransactionType.EXPENSE;
import static app.accountbook.transaction.TransactionType.INCOME;

import app.accountbook.account.AccountType;
import app.accountbook.transaction.TransactionType;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.List;

/**
 * 데모 장부의 계좌 3개와 지난달·이번 달 거래(#349). 이름과 가맹점은 지어낸 일반 이름이고 금액은 원 정수다. 날짜는 실행한 날
 * (장부 시간대의 오늘)로 정하고 이번 달 거래는 오늘을 넘지 않는다. 카드 대금은 그 전의 카드 지출보다 크지 않다(부채 계좌).
 */
final class DemoSamples {

    /** 계좌 하나. 기준일은 모두 {@link #openingDate}다. */
    record DemoAccount(String label, AccountType type, long openingBalance) {
    }

    static final DemoAccount CASH = new DemoAccount("지갑", AccountType.CASH, 50_000);
    static final DemoAccount BANK = new DemoAccount("생활비 통장", AccountType.BANK, 1_500_000);
    static final DemoAccount CARD = new DemoAccount("신용카드", AccountType.CARD, 0);
    static final List<DemoAccount> ACCOUNTS = List.of(CASH, BANK, CARD);

    /** 거래 하나. monthsAgo 0은 이번 달, 1은 지난달. text는 지출·수입의 가맹점이고 이체(카테고리 없음)의 메모다. */
    record Sample(int monthsAgo, int day, TransactionType type, DemoAccount account, DemoAccount toAccount,
                  String category, long amount, String text) {

        /** 그 달의 day일. 이번 달이면 오늘을, 지난달이면 그 달의 마지막 날을 넘지 않는다. */
        LocalDate date(LocalDate today) {
            YearMonth month = YearMonth.from(today).minusMonths(monthsAgo);
            int lastDay = monthsAgo == 0 ? today.getDayOfMonth() : month.lengthOfMonth();
            return month.atDay(Math.min(day, lastDay));
        }
    }

    static final List<Sample> SAMPLES = List.of(
            entry(1, 3, EXPENSE, CARD, "식비", 12_000, "골목 분식"),
            entry(1, 5, EXPENSE, CARD, "카페·간식", 4_500, "역 앞 카페"),
            entry(1, 6, EXPENSE, CASH, "교통", 1_500, "버스"),
            entry(1, 8, EXPENSE, BANK, "주거·통신", 55_000, "휴대폰 요금"),
            entry(1, 10, INCOME, BANK, "급여", 3_200_000, "월급"),
            entry(1, 12, EXPENSE, CARD, "생활용품", 23_800, "동네 마트"),
            entry(1, 15, EXPENSE, CARD, "문화·여가", 15_000, "동네 영화관"),
            transfer(1, 20, BANK, CARD, 55_300, "카드 대금"),
            entry(1, 22, EXPENSE, CARD, "의료·건강", 8_200, "동네 약국"),
            entry(1, 25, INCOME, BANK, "부수입", 150_000, "중고 거래"),
            entry(1, 27, EXPENSE, CASH, "식비", 9_000, "시장 국밥"),
            transfer(1, 31, BANK, CASH, 100_000, "현금 인출"),
            entry(0, 1, EXPENSE, CARD, "식비", 8_500, "편의점"),
            entry(0, 2, EXPENSE, CASH, "교통", 1_500, "지하철"),
            entry(0, 4, EXPENSE, CARD, "카페·간식", 5_200, "역 앞 카페"),
            entry(0, 8, EXPENSE, BANK, "주거·통신", 55_000, "휴대폰 요금"),
            entry(0, 10, INCOME, BANK, "급여", 3_200_000, "월급"),
            entry(0, 14, EXPENSE, CARD, "쇼핑", 39_000, "온라인 쇼핑몰"),
            entry(0, 18, EXPENSE, CARD, "식비", 32_000, "동네 마트"),
            transfer(0, 20, BANK, CARD, 63_500, "카드 대금"),
            entry(0, 21, EXPENSE, CASH, "경조사·선물", 50_000, "꽃집"));

    private DemoSamples() {
    }

    /** 계좌의 기준일: 지난달 1일. 모든 거래가 이날부터다. */
    static LocalDate openingDate(LocalDate today) {
        return YearMonth.from(today).minusMonths(1).atDay(1);
    }

    private static Sample entry(int monthsAgo, int day, TransactionType type, DemoAccount account, String category,
                                long amount, String payee) {
        return new Sample(monthsAgo, day, type, account, null, category, amount, payee);
    }

    private static Sample transfer(int monthsAgo, int day, DemoAccount from, DemoAccount to, long amount,
                                   String memo) {
        return new Sample(monthsAgo, day, TransactionType.TRANSFER, from, to, null, amount, memo);
    }
}
