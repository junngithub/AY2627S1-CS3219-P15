package sg.edu.nus.cs3219.order.rest;

import sg.edu.nus.cs3219.order.client.UserAccount;

public final class CallerHeaders {

    public static final String USER_ID = "X-User-Id";
    public static final String EMAIL = "X-User-Email";
    public static final String TELEGRAM = "X-User-Telegram";

    private CallerHeaders() {
    }

    public static UserAccount require(String userId, String email, String telegram) {
        if (userId == null || userId.isBlank() || email == null || email.isBlank()) {
            throw ApiException.unauthorized("Sign in is required");
        }
        String id = userId.trim();
        String address = email.trim();
        String handle = telegram == null ? "" : telegram.trim();
        if (handle.isBlank()) {
            int at = address.indexOf('@');
            handle = at > 0 ? address.substring(0, at) : address;
        }
        return new UserAccount(id, address, handle);
    }
}
