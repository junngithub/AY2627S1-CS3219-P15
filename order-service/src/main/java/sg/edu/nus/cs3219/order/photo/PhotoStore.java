package sg.edu.nus.cs3219.order.photo;

import org.springframework.web.multipart.MultipartFile;

import java.util.UUID;

public interface PhotoStore {

    String store(UUID orderId, String role, MultipartFile file);

    void delete(String reference);
}
