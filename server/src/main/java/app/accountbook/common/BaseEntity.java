package app.accountbook.common;

import jakarta.persistence.Column;
import jakarta.persistence.Id;
import jakarta.persistence.MappedSuperclass;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Transient;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import org.springframework.data.domain.Persistable;

/**
 * 모든 테이블이 가진 {@code id UUID PK}와 {@code created_at}.
 * id는 생성 시점에 정해지므로(거래는 클라이언트 값, 나머지는 서버 값) Persistable로 새 엔터티 여부를 직접 알려
 * Spring Data가 merge(SELECT 후 INSERT) 대신 persist를 쓰게 한다.
 */
@MappedSuperclass
public abstract class BaseEntity implements Persistable<UUID> {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Transient
    private boolean newEntity = true;

    protected BaseEntity() {
    }

    protected BaseEntity(UUID id) {
        this(id, Times.now());
    }

    protected BaseEntity(UUID id, Instant createdAt) {
        this.id = Objects.requireNonNull(id, "id");
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt");
    }

    @Override
    public UUID getId() {
        return id;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    @Override
    public boolean isNew() {
        return newEntity;
    }

    /**
     * persist 시점(@PrePersist)에 새 엔터티 표시를 지운다. @PostPersist는 INSERT가 실행되는 flush 때까지 미뤄져서,
     * 그 사이 Spring Data의 delete()가 아직 새 엔터티로 보고 아무것도 하지 않는 문제가 생긴다.
     */
    @PrePersist
    @PostLoad
    void markNotNew() {
        newEntity = false;
    }
}
