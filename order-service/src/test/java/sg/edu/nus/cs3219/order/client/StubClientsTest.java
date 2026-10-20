package sg.edu.nus.cs3219.order.client;

import org.junit.jupiter.api.Test;
import sg.edu.nus.cs3219.order.rest.ApiException;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class StubClientsTest {

    private final StubClients clients = new StubClients();

    @Test
    void ratingsAndEscalationsStayLocal() {
        assertEquals(5.0, clients.ratingFor("55555555-5555-5555-5555-555555555555", null));
        clients.escalate(context(UUID.randomUUID(), "wrong item"), null);
        assertThrows(ApiException.class, () -> clients.escalate(null, null));
        OrderContext blank = context(UUID.randomUUID(), " ");
        assertThrows(ApiException.class, () -> clients.escalate(blank, null));
        OrderContext missingOrder = context(null, "wrong item");
        assertThrows(ApiException.class, () -> clients.escalate(missingOrder, null));
    }

    private static OrderContext context(UUID orderId, String comment) {
        return new OrderContext(orderId, null, null, 1, null, null, null, null, null, null,
                null, null, null, null, null, null, null, 0, 0, null, null, 0, 0, null, null, null, comment);
    }
}
