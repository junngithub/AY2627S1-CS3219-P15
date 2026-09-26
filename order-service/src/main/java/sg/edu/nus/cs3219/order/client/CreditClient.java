package sg.edu.nus.cs3219.order.client;

import java.util.UUID;

public interface CreditClient {

    void reserve(UUID orderId, String requesterId, int amount, String authorization);

    void returnReserved(UUID orderId, String authorization);
}
