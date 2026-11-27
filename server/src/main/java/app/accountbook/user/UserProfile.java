package app.accountbook.user;

/** 사용자가 자기 자신에 대해 보는 값(F-014). 비밀번호 해시는 담지 않는다. */
public record UserProfile(String email, String displayName) {

    static UserProfile of(User user) {
        return new UserProfile(user.getEmail(), user.getDisplayName());
    }
}
