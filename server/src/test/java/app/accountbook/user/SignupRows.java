package app.accountbook.user;

import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;

/** 실제로 커밋하는 가입 테스트의 행 세기와 뒷정리. */
public final class SignupRows {

    private static final List<String> TABLES = List.of("users", "ledger", "ledger_member", "category");

    private SignupRows() {
    }

    /** users, ledger, ledger_member, category의 행 수. */
    static List<Long> counts(JdbcTemplate jdbc) {
        return TABLES.stream()
                .map(table -> jdbc.queryForObject("select count(*) from " + table, Long.class))
                .toList();
    }

    /** 커밋된 가입 하나(사용자, 장부, 구성원, 카테고리)를 지운다. 없으면 아무것도 하지 않는다. */
    public static void delete(JdbcTemplate jdbc, String email) {
        List<UUID> ledgerIds = jdbc.queryForList("""
                select m.ledger_id from ledger_member m join users u on u.id = m.user_id where u.email = ?
                """, UUID.class, email);
        ledgerIds.forEach(ledgerId -> {
            jdbc.update("delete from category where ledger_id = ?", ledgerId);
            jdbc.update("delete from ledger_member where ledger_id = ?", ledgerId);
            jdbc.update("delete from ledger where id = ?", ledgerId);
        });
        jdbc.update("delete from users where email = ?", email);
    }
}
