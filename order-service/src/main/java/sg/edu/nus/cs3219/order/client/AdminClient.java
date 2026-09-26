package sg.edu.nus.cs3219.order.client;

public interface AdminClient {

    void escalate(OrderContext order, String authorization);
}
