package sg.edu.nus.cs3219.order.client;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import sg.edu.nus.cs3219.order.config.OrderProperties;
import sg.edu.nus.cs3219.order.rest.ApiException;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HttpClientsTest {

    private HttpServer server;
    private ExecutorService executor;
    private HttpClients clients;
    private final AtomicReference<String> lastPath = new AtomicReference<>();
    private final AtomicReference<String> lastBody = new AtomicReference<>();
    private final AtomicReference<String> lastUser = new AtomicReference<>();
    private final UserAccount ada = new UserAccount("ada-id", "ada@u.nus.edu", "ada");

    @BeforeEach
    void setUp() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        executor = Executors.newCachedThreadPool(task -> {
            Thread thread = new Thread(task, "http-clients-test");
            thread.setDaemon(true);
            return thread;
        });
        server.setExecutor(executor);
        server.createContext("/", exchange -> {
            lastPath.set(exchange.getRequestURI().getPath());
            lastBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] empty = "null".getBytes(StandardCharsets.UTF_8);
            lastUser.set(exchange.getRequestHeaders().getFirst("X-User-Id"));
            byte[] body = switch (exchange.getRequestURI().getPath()) {
                case "/api/v1/supplier/nus-coop" -> "{\"id\":\"nus-coop\",\"name\":\"NUS Co-op\",\"latitude\":1.2,\"longitude\":103.7,\"building\":\"COM2\"}".getBytes(StandardCharsets.UTF_8);
                case "/api/v1/supplier/empty" -> empty;
                case "/api/v1/rating/ada-id" -> "{\"average\":4.25,\"count\":3}".getBytes(StandardCharsets.UTF_8);
                case "/api/v1/rating/missing" -> empty;
                default -> empty;
            };
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        clients = clients("http://127.0.0.1:" + server.getAddress().getPort());
    }

    @AfterEach
    void tearDown() {
        server.stop(0);
        executor.shutdownNow();
    }

    @Test
    void callsTheOtherServices() {
        UUID orderId = UUID.randomUUID();
        clients.reserve(orderId, "ada-id", 8, ada);
        assertEquals("ada-id", lastUser.get());
        assertTrue(lastBody.get().contains(orderId.toString()));
        assertTrue(lastBody.get().contains("requesterId"));
        clients.returnReserved(orderId, ada);
        assertEquals("/api/v1/credit/release", lastPath.get());

        Place place = clients.requirePlace("nus-coop", ada);
        assertEquals("NUS Co-op", place.name());
        assertEquals(1.2, place.latitude());
        assertEquals(4.25, clients.ratingFor("ada-id", ada));
        clients.escalate(new OrderContext(orderId, "COLLECTED", "Print notes", 8,
                "ada@u.nus.edu", "ada", 5.0, "courier@u.nus.edu", "courier", 4.0,
                null, null, null, null, null, "nus-coop", "NUS Co-op", 1.2, 103.7,
                "cool-spot", "Cool Spot", 1.3, 103.8, "collection", "delivery", "dispute", "wrong item"), ada);
        assertTrue(lastBody.get().contains(orderId.toString()));
        assertTrue(lastBody.get().contains("Print notes"));
        assertTrue(lastBody.get().contains("collection"));
        assertEquals("/escalations", lastPath.get());
    }

    @Test
    void rejectsAnEmptySupplierAndRating() {
        assertThrows(ApiException.class, () -> clients.requirePlace("empty", ada));
        assertThrows(ApiException.class, () -> clients.ratingFor("missing", ada));
    }

    @Test
    void reportsAnUnavailableService() {
        HttpClients down = clients("http://127.0.0.1:1");
        UUID orderId = UUID.randomUUID();
        OrderContext escalation = new OrderContext(orderId, null, null, 1,
                null, null, null, null, null, null, null, null, null, null, null,
                null, null, 0, 0, null, null, 0, 0, null, null, null, "text");
        assertThrows(ApiException.class, () -> down.reserve(orderId, "ada-id", 1, ada));
        assertThrows(ApiException.class, () -> down.returnReserved(orderId, ada));
        assertThrows(ApiException.class, () -> down.requirePlace("nus-coop", ada));
        assertThrows(ApiException.class, () -> down.ratingFor("ada-id", ada));
        assertThrows(ApiException.class, () -> down.escalate(escalation, ada));
    }

    private static HttpClients clients(String baseUrl) {
        OrderProperties properties = new OrderProperties();
        properties.getClients().setTimeout(java.time.Duration.ofSeconds(1));
        properties.getClients().setCreditBaseUrl(baseUrl);
        properties.getClients().setSupplierBaseUrl(baseUrl);
        properties.getClients().setRatingBaseUrl(baseUrl);
        properties.getClients().setAdminBaseUrl(baseUrl);
        return new HttpClients(properties);
    }
}
