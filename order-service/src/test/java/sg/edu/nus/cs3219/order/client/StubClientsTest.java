package sg.edu.nus.cs3219.order.client;

import org.junit.jupiter.api.Test;
import sg.edu.nus.cs3219.order.rest.ApiException;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class StubClientsTest {

    private final StubClients clients = new StubClients();

    @Test
    void acceptsCampusEmailsAndRejectsAnythingElse() {
        UserAccount ada = clients.authenticate("Bearer stub:ada@u.nus.edu");
        assertEquals("ada@u.nus.edu", ada.userId());
        assertEquals("ada", ada.telegramHandle());
        assertEquals("bob@nus.edu.sg", clients.authenticate("Bearer stub:bob@nus.edu.sg").email());
        assertThrows(ApiException.class, () -> clients.authenticate(null));
        assertThrows(ApiException.class, () -> clients.authenticate("Bearer ada@u.nus.edu"));
        assertThrows(ApiException.class, () -> clients.authenticate("Bearer stub:ada@gmail.com"));
    }

    @Test
    void reservesAndReturnsCredits() {
        UUID orderId = UUID.randomUUID();
        clients.reserve(orderId, "ada@u.nus.edu", 8, null);
        clients.returnReserved(orderId, null);
        clients.reserve(orderId, "ada@u.nus.edu", 20, null);
        assertThrows(ApiException.class, () -> clients.reserve(UUID.randomUUID(), "ada@u.nus.edu", 1, null));
        assertThrows(ApiException.class, () -> clients.reserve(UUID.randomUUID(), "ada@u.nus.edu", 0, null));
        assertThrows(ApiException.class, () -> clients.returnReserved(UUID.randomUUID(), null));
    }

    @Test
    void looksUpPlacesRatingsAndEscalations() {
        assertEquals("NUS Co-op", clients.requirePlace("nus-coop", null).name());
        assertEquals(5.0, clients.ratingFor("ada@u.nus.edu", null));
        clients.escalate(context(UUID.randomUUID(), "wrong item"), null);
        assertThrows(ApiException.class, () -> clients.requirePlace("nowhere", null));
        assertThrows(ApiException.class, () -> clients.escalate(null, null));
        assertThrows(ApiException.class, () -> clients.escalate(context(UUID.randomUUID(), " "), null));
    }

    private static OrderContext context(UUID orderId, String comment) {
        return new OrderContext(orderId, null, null, 1, null, null, null, null, null, null,
                null, null, null, null, null, null, null, 0, 0, null, null, 0, 0, null, null, null, comment);
    }
}
