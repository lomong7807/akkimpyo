package app.accountbook.user;

import app.accountbook.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;

@Entity
@Table(name = "users")
public class User extends BaseEntity {

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
