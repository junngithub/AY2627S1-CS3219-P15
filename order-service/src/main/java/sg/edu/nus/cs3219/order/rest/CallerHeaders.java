package sg.edu.nus.cs3219.order.rest;

import sg.edu.nus.cs3219.order.client.UserAccount;

import java.util.UUID;

public final class CallerHeaders {

    public static final String USER_ID = "X-User-Id";
    public static final String PERMITTED = "X-Permitted-Action";

    private CallerHeaders() {
    }

    public static UserAccount require(String userId, String permittedAction) {
        if (userId == null || userId.isBlank()) {
            throw ApiException.unauthorized("Sign in is required");
        }
        UUID id;
        try {
            id = UUID.fromString(userId.trim());
        } catch (IllegalArgumentException exception) {
            throw ApiException.unauthorized("Sign in is required");
        }
        if (permittedAction == null || !"true".equalsIgnoreCase(permittedAction.trim())) {
            throw ApiException.forbidden("This account is not permitted to use orders");
        }
        return new UserAccount(id.toString());
    }
}
