package sg.edu.nus.cs3219.order.client;

import java.util.List;
import java.util.UUID;

public interface AdminClient {

    void openConflict(UUID orderId, String reporterUserId, String comment, List<String> photos);
}
