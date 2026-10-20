package sg.edu.nus.cs3219.order.photo;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;
import sg.edu.nus.cs3219.order.config.OrderProperties;
import sg.edu.nus.cs3219.order.rest.ApiException;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;

import java.io.IOException;
import java.util.UUID;

@Component
@ConditionalOnProperty(name = "order.photos.mode", havingValue = "s3")
public class S3PhotoStore implements PhotoStore {

    private final S3Client s3;
    private final String bucket;

    public S3PhotoStore(S3Client s3, OrderProperties properties) {
        this.s3 = s3;
        this.bucket = properties.getPhotos().getBucket();
    }

    @Override
    public String store(UUID orderId, String role, MultipartFile file) {
        PhotoRules.requirePresent(file);
        String extension = PhotoRules.extensionFor(file.getContentType());
        String key = orderId + "/" + role + "." + extension;
        try {
            s3.putObject(
                    PutObjectRequest.builder()
                            .bucket(bucket)
                            .key(key)
                            .contentType(file.getContentType())
                            .build(),
                    RequestBody.fromBytes(file.getBytes())
            );
            return key;
        } catch (IOException | S3Exception exception) {
            throw ApiException.badRequest("The photo could not be stored. Please retry the upload");
        }
    }

    @Override
    public void delete(String reference) {
        if (reference == null || reference.isBlank()) {
            return;
        }
        try {
            s3.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(reference).build());
        } catch (S3Exception exception) {
            throw ApiException.unavailable("Stored photos could not be deleted");
        }
    }
}
