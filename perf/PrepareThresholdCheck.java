import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.UUID;
import org.postgresql.PGProperty;

/**
 * 이 프로젝트와 같은 pgJDBC가 장부 전체 잔액을 몇 번째 실행부터 서버 쪽 준비된 문장으로 보내고,
 * 서버가 몇 번째부터 일반 계획을 쓰는지 본다. 사용법은 perf/README.md에 있다.
 * 문장은 perf/queries/balances.sql에서 읽고, Hibernate처럼 실행할 때마다 만들고 닫는다.
 */
public class PrepareThresholdCheck {

    private static final int RUNS = 14;

    public static void main(String[] args) throws Exception {
        String url = args[0];
        String sql = Files.readAllLines(Path.of("perf/queries/balances.sql")).stream()
                .filter(line -> line.startsWith("select "))
                .findFirst().orElseThrow()
                .replaceAll(":p\\d+", "?")
                .replaceAll(";$", "");
        System.out.println("pgJDBC 기본값: "
                + PGProperty.PREPARE_THRESHOLD.getName() + "=" + PGProperty.PREPARE_THRESHOLD.getDefaultValue() + ", "
                + PGProperty.PREPARED_STATEMENT_CACHE_QUERIES.getName() + "="
                + PGProperty.PREPARED_STATEMENT_CACHE_QUERIES.getDefaultValue() + ", "
                + PGProperty.PREFER_QUERY_MODE.getName() + "=" + PGProperty.PREFER_QUERY_MODE.getDefaultValue());
        try (Connection connection = DriverManager.getConnection(url, "accountbook", "accountbook")) {
            System.out.println("드라이버 " + connection.getMetaData().getDriverVersion()
                    + ", 서버 " + connection.getMetaData().getDatabaseProductVersion());
            UUID ledgerId = ledgerId(connection, Integer.parseInt(args[1]));
            for (int run = 1; run <= RUNS; run++) {
                execute(connection, sql, ledgerId);
                System.out.println(run + "번째 실행 뒤: " + preparedStatement(connection));
            }
        }
    }

    private static UUID ledgerId(Connection connection, int ledgerNo) throws SQLException {
        try (Statement statement = connection.createStatement();
             ResultSet rows = statement.executeQuery("SELECT md5('perf-ledger-" + ledgerNo + "')::uuid")) {
            rows.next();
            return rows.getObject(1, UUID.class);
        }
    }

    private static void execute(Connection connection, String sql, UUID ledgerId) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setObject(1, ledgerId);
            statement.setObject(2, ledgerId);
            statement.setString(3, "CANCELED");
            try (ResultSet rows = statement.executeQuery()) {
                while (rows.next()) {
                    rows.getLong(2);
                }
            }
        }
    }

    private static String preparedStatement(Connection connection) throws SQLException {
        try (Statement statement = connection.createStatement();
             ResultSet rows = statement.executeQuery(
                     "SELECT name, parameter_types, custom_plans, generic_plans FROM pg_prepared_statements"
                             + " WHERE statement LIKE '%transaction_line%' AND statement NOT LIKE '%pg_prepared%'")) {
            return rows.next()
                    ? "준비된 문장 " + rows.getString(1) + " " + rows.getString(2) + ", 값에 맞춘 계획 "
                            + rows.getLong(3) + "번, 일반 계획 " + rows.getLong(4) + "번"
                    : "준비된 문장 없음";
        }
    }
}
