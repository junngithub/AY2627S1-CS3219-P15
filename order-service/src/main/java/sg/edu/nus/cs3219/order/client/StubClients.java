package sg.edu.nus.cs3219.order.client;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import sg.edu.nus.cs3219.order.rest.ApiException;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Component
@ConditionalOnProperty(name = "order.clients.mode", havingValue = "stub", matchIfMissing = true)
public class StubClients implements UserClient, CreditClient, SupplierClient, RatingClient, AdminClient {

    private static final Map<String, Place> PLACES = Map.of(
            "annas", new Place("annas", "Anna's x Soup Union", 1.296444, 103.773032),
            "nus-coop", new Place("nus-coop", "NUS Co-op", 1.2967866, 103.7732677),
            "printer-com2", new Place("printer-com2", "Printer @ Com 2", 1.2938347, 103.7744572),
            "cool-spot", new Place("cool-spot", "Cool Spot", 1.2940156, 103.7738478),
            "instachef", new Place("instachef", "InstaChef", 1.2938898, 103.7736305),
            "robot-cafe", new Place("robot-cafe", "Cafe+ Robot Cafe", 1.296444, 103.773032)
    );

    private final Map<String, Integer> balances = new ConcurrentHashMap<>();
    private final Map<UUID, Reservation> reservations = new ConcurrentHashMap<>();

    @Override
    public UserAccount authenticate(String authorizationHeader) {
        if (authorizationHeader == null || !authorizationHeader.startsWith("Bearer stub:")) {
            throw ApiException.unauthorized("Sign in is required");
        }
        String email = authorizationHeader.substring("Bearer stub:".length()).trim();
        if (!email.endsWith("@u.nus.edu") && !email.endsWith("@nus.edu.sg")) {
            throw ApiException.unauthorized("Sign in is required");
        }
        String handle = email.substring(0, email.indexOf('@'));
        return new UserAccount(email, email, handle);
    }

    @Override
    public synchronized void reserve(UUID orderId, String requesterId, int amount, String authorization) {
        int balance = balances.getOrDefault(requesterId, 20);
        if (amount < 1 || balance < amount) {
            throw ApiException.badRequest("Not enough credits for this reward");
        }
        balances.put(requesterId, balance - amount);
        reservations.put(orderId, new Reservation(requesterId, amount));
    }

    @Override
    public synchronized void returnReserved(UUID orderId, String authorization) {
        Reservation reservation = reservations.remove(orderId);
        if (reservation == null) {
            throw ApiException.badRequest("No reserved credits were found for this order");
        }
        balances.merge(reservation.requesterId(), reservation.amount(), Integer::sum);
    }

    @Override
    public Place requirePlace(String locationId, String authorization) {
        Place place = PLACES.get(locationId);
        if (place == null) {
            throw ApiException.badRequest("That location is not an approved supplier");
        }
        return place;
    }

    @Override
    public double ratingFor(String userId, String authorization) {
        return 5.0;
    }

    @Override
    public void escalate(OrderContext order, String authorization) {
        if (order == null || order.orderId() == null || order.comment() == null || order.comment().isBlank()) {
            throw ApiException.badRequest("A dispute description is required");
        }
    }

    private record Reservation(String requesterId, int amount) {
    }
}
