package sg.edu.nus.cs3219.order.client;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class StubClientsTest {

    private final StubClients clients = new StubClients();

    @Test
    void ratingsStayLocal() {
        assertEquals(5.0, clients.ratingFor("55555555-5555-5555-5555-555555555555", null));
    }
}
