package app.accountbook.user;

import app.accountbook.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;

@Entity
@Table(name = "users")
public class User extends BaseEntity {

    /** 메일 주소의 실무 상한. RFC 5321의 경로 길이 256에서 꺾쇠 둘을 뺀 값이고 DB의 ck_users_email_length와 같다. */
    public static final int EMAIL_MAX_LENGTH = 254;

    public static final int DISPLAY_NAME_MAX_LENGTH = 20;

    @Column(name = "email", nullable = false, unique = true)
    private String email;

    @Column(name = "password_hash", nullable = false)
    private String passwordHash;

    @Column(name = "display_name", nullable = false)
    private String displayName;

    protected User() {
    }

    private User(String email, String passwordHash, String displayName) {
        super(UUID.randomUUID());
        this.email = email;
        this.passwordHash = passwordHash;
        this.displayName = displayName;
    }

    public static User of(String email, String passwordHash, String displayName) {
        return new User(email, passwordHash, displayName);
    }

    public String getEmail() {
        return email;
    }

    public String getPasswordHash() {
        return passwordHash;
    }

    public String getDisplayName() {
        return displayName;
    }
}
