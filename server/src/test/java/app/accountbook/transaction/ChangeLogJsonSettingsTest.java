package app.accountbook.transaction;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.account.AccountType;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.user.User;
import jakarta.persistence.EntityManager;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.TestPropertySource;
import tools.jackson.databind.json.JsonMapper;

/**
 * API가 쓰는 JSON 설정을 바꿔도 이력의 저장 형식은 그대로다(ADR 007 결정 4).
 * API의 시각 형식(ADR 002)은 저장 형식과 달라 앞으로 이 설정이 바뀔 수 있다.
 */
@IntegrationTest
@TestPropertySource(properties = {
        "spring.jackson.property-naming-strategy=SNAKE_CASE",
        "spring.jackson.default-property-inclusion=non_null",
        "spring.jackson.datatype.datetime.write-dates-as-timestamps=true"})
class ChangeLogJsonSettingsTest {

    static final LocalDate DAY = LocalDate.of(2026, 11, 18);

    @Autowired TransactionService transactionService;
    @Autowired JsonMapper apiMapper;
    @Autowired Fixtures fixtures;
    @Autowired EntityManager entityManager;
    @Autowired JdbcTemplate jdbc;

    @Test
    void 스프링의_JSON_설정이_바뀌어도_저장되는_전후_값은_그대로다() {
        User owner = fixtures.user("owner@example.com");
        UUID ledgerId = fixtures.personalLedgerId(owner);
        UUID bank = fixtures.account(owner, ledgerId, "국민은행", AccountType.BANK, 0, DAY).getId();
        UUID cash = fixtures.account(owner, ledgerId, "현금", AccountType.CASH, 0, DAY).getId();
        TransactionView created = fixtures.transfer(owner, ledgerId, bank, cash, DAY, 30_000);
        assertThat(apiMapper.valueToTree(created).propertyNames()).as("설정이 걸린 매퍼")
                .contains("occurred_on").doesNotContain("occurredOn", "memo");

        entityManager.flush();
        String stored = jdbc.queryForObject("select cast(after_value as text) from change_log where transaction_id = ?",
                String.class, created.id());

        JsonMapper plain = JsonMapper.builder().build();
        assertThat(plain.readTree(stored)).isEqualTo(plain.readTree("""
                {"id": "%s", "ledgerId": "%s", "type": "TRANSFER", "occurredOn": "2026-11-18", "occurredTime": null,
                 "payee": null, "memo": null, "status": "POSTED", "createdBy": "%s", "paidBy": null,
                 "version": 1, "deleted": false, "createdAt": "%s", "updatedAt": "%s",
                 "lines": [{"accountId": "%s", "categoryId": null, "amount": -30000},
                           {"accountId": "%s", "categoryId": null, "amount": 30000}]}
                """.formatted(created.id(), ledgerId, owner.getId(), created.createdAt(), created.createdAt(), bank,
                cash)));
    }
}
