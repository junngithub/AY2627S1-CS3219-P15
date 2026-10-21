package sg.edu.nus.cs3219.order.client;

import org.springframework.stereotype.Component;

@Component
public class StubClients implements RatingClient {

    @Override
    public double ratingFor(String userId, UserAccount caller) {
        return 5.0;
    }
}
