package sg.edu.nus.cs3219.order.client;

public interface UserClient {

    UserAccount authenticate(String authorizationHeader);
}
