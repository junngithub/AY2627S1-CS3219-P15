package sg.edu.nus.cs3219.order.client;

import org.springframework.stereotype.Component;
import sg.edu.nus.cs3219.order.rest.ApiException;

@Component
public class StubClients implements RatingClient, AdminClient {

    @Override
    public double ratingFor(String userId, UserAccount caller) {
        return 5.0;
    }

    @Override
    public void escalate(OrderContext order, UserAccount caller) {
        if (order == null || order.orderId() == null || order.comment() == null || order.comment().isBlank()) {
            throw ApiException.badRequest("A dispute description is required");
        }
    }
}
