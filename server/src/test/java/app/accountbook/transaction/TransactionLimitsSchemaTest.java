package app.accountbook.transaction;

import static app.accountbook.support.CheckConstraints.CHANGE_BOTH;
import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.support.CheckConstraints;
import app.accountbook.support.IntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 거래 금액 범위(P-201)의 앱 상수와 DB CHECK가 같은지 본다(이슈 #63). TransactionLimits가 패키지 안에만 보여 여기 둔다.
 * 나머지 값은 SchemaValueMatchTest가 본다.
 */
@IntegrationTest
class TransactionLimitsSchemaTest {

    @Autowired JdbcTemplate jdbc;

    @Test
    void lineAmountRangeMatchesTransactionLimits() {
        CheckConstraints checks = CheckConstraints.of(jdbc);
        String table = "transaction_line";
        String constraint = "ck_transaction_line_amount_range";
        String mismatch = "TransactionLimits와 " + constraint + "가 다르다. " + CHANGE_BOTH;

        // 입력 금액은 부호 없는 크기 [MIN_AMOUNT, MAX_AMOUNT]이고 라인에는 부호를 붙여 저장한다.
        // DB는 [-상한, 상한]에서 0 하나만 뺀다. 그래서 MIN_AMOUNT는 DB가 빼는 값의 바로 위여야 한다.
        assertThat(checks.comparedLong(table, constraint, "amount", "<=")).as(mismatch)
                .isEqualTo(TransactionLimits.MAX_AMOUNT);
        assertThat(checks.comparedLong(table, constraint, "amount", ">=")).as(mismatch)
                .isEqualTo(-TransactionLimits.MAX_AMOUNT);
        assertThat(checks.comparedLong(table, constraint, "amount", "<>") + 1).as(mismatch)
                .isEqualTo(TransactionLimits.MIN_AMOUNT);
    }
}
