package sg.edu.nus.cs3219.order.photo;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;
import sg.edu.nus.cs3219.order.config.OrderProperties;
import sg.edu.nus.cs3219.order.rest.ApiException;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.UUID;

@Component
@ConditionalOnProperty(name = "order.photos.mode", havingValue = "file", matchIfMissing = true)
public class FilePhotoStore implements PhotoStore {

    private final Path root;

    public FilePhotoStore(OrderProperties properties) {
        this.root = Path.of(properties.getPhotos().getDirectory());
    }

    @Override
    public String store(UUID orderId, String role, MultipartFile file) {
        PhotoRules.requirePresent(file);
        String extension = PhotoRules.extensionFor(file.getContentType());
        Path directory = root.resolve(orderId.toString());
        try {
            Files.createDirectories(directory);
            Path target = directory.resolve(role + "." + extension);
            try (InputStream input = file.getInputStream()) {
                Files.copy(input, target, StandardCopyOption.REPLACE_EXISTING);
            }
            return orderId + "/" + role + "." + extension;
        } catch (IOException exception) {
            throw ApiException.badRequest("The photo could not be stored. Please retry the upload");
        }
    }

    @Override
    public void delete(String reference) {
        if (reference == null || reference.isBlank()) {
            return;
        }
        try {
            Files.deleteIfExists(root.resolve(reference));
        } catch (IOException exception) {
            throw ApiException.unavailable("Stored photos could not be deleted");
        }
    }
}
