package sg.edu.nus.cs3219.order.client;

public interface SupplierClient {

    Place requirePlace(String locationId, UserAccount caller);
}
