package sg.edu.nus.cs3219.order.client;

import org.junit.jupiter.api.Test;
import sg.edu.nus.cs3219.order.rest.ApiException;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class StubClientsTest {

    private final StubClients clients = new StubClients();

    @Test
    void reservesAndReturnsCredits() {
        UUID orderId = UUID.randomUUID();
        clients.reserve(orderId, "ada@u.nus.edu", 8, null);
        clients.returnReserved(orderId, null);
        clients.reserve(orderId, "ada@u.nus.edu", 20, null);
        UUID overdrawn = UUID.randomUUID();
        UUID free = UUID.randomUUID();
        UUID unknown = UUID.randomUUID();
        assertThrows(ApiException.class, () -> clients.reserve(overdrawn, "ada@u.nus.edu", 1, null));
        assertThrows(ApiException.class, () -> clients.reserve(free, "ada@u.nus.edu", 0, null));
        assertThrows(ApiException.class, () -> clients.returnReserved(unknown, null));
    }

    @Test
    void looksUpPlacesRatingsAndEscalations() {
        assertEquals("NUS Co-op", clients.requirePlace("nus-coop", null).name());
        assertEquals(5.0, clients.ratingFor("ada@u.nus.edu", null));
        clients.escalate(context(UUID.randomUUID(), "wrong item"), null);
        assertThrows(ApiException.class, () -> clients.requirePlace("nowhere", null));
        assertThrows(ApiException.class, () -> clients.escalate(null, null));
        OrderContext blank = context(UUID.randomUUID(), " ");
        assertThrows(ApiException.class, () -> clients.escalate(blank, null));
    }

    private static OrderContext context(UUID orderId, String comment) {
        return new OrderContext(orderId, null, null, 1, null, null, null, null, null, null,
                null, null, null, null, null, null, null, 0, 0, null, null, 0, 0, null, null, null, comment);
    }
}
