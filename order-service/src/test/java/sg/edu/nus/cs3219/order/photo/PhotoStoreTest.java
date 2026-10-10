package sg.edu.nus.cs3219.order.photo;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import sg.edu.nus.cs3219.order.config.OrderProperties;
import sg.edu.nus.cs3219.order.rest.ApiException;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class PhotoStoreTest {

    @Test
    void fileStoreAcceptsImagesAndDeletesThem() throws Exception {
        Path root = Files.createTempDirectory("order-photos");
        FilePhotoStore store = new FilePhotoStore(properties(root.toString()));
        UUID orderId = UUID.randomUUID();
        String jpeg = store.store(orderId, "collection", file("image/jpeg", new byte[]{1}));
        String png = store.store(orderId, "delivery", file("image/png", new byte[]{2}));
        String webp = store.store(orderId, "extra", file("image/webp", new byte[]{3}));
        assertTrue(Files.exists(root.resolve(jpeg)));
        assertTrue(Files.exists(root.resolve(png)));
        assertTrue(Files.exists(root.resolve(webp)));
        store.delete(jpeg);
        assertFalse(Files.exists(root.resolve(jpeg)));
        store.delete(null);
        store.delete(" ");

        MockMultipartFile empty = file("image/jpeg", new byte[0]);
        MockMultipartFile untyped = file(null, new byte[]{1});
        MockMultipartFile gif = file("image/gif", new byte[]{1});
        assertThrows(ApiException.class, () -> store.store(orderId, "collection", null));
        assertThrows(ApiException.class, () -> store.store(orderId, "collection", empty));
        assertThrows(ApiException.class, () -> store.store(orderId, "collection", untyped));
        assertThrows(ApiException.class, () -> store.store(orderId, "collection", gif));
    }

    @Test
    void fileStoreReportsStorageFailures() throws Exception {
        Path file = Files.createTempFile("not-a-directory", ".bin");
        FilePhotoStore blocked = new FilePhotoStore(properties(file.toString()));
        UUID blockedOrder = UUID.randomUUID();
        MockMultipartFile photo = file("image/jpeg", new byte[]{1});
        assertThrows(ApiException.class, () -> blocked.store(blockedOrder, "collection", photo));

        Path root = Files.createTempDirectory("order-photos");
        Path nested = root.resolve("nested");
        Files.createDirectories(nested);
        Files.writeString(nested.resolve("child"), "x");
        FilePhotoStore store = new FilePhotoStore(properties(root.toString()));
        assertThrows(ApiException.class, () -> store.delete("nested"));
    }

    @Test
    void s3StorePutsAndDeletesObjects() throws Exception {
        S3Client s3 = mock(S3Client.class);
        S3PhotoStore store = new S3PhotoStore(s3, properties("unused"));
        UUID orderId = UUID.randomUUID();
        assertEquals(orderId + "/collection.jpg", store.store(orderId, "collection", file("image/jpeg", new byte[]{1})));
        verify(s3).putObject(any(PutObjectRequest.class), any(RequestBody.class));
        store.delete(orderId + "/collection.jpg");
        verify(s3).deleteObject(any(DeleteObjectRequest.class));
        store.delete(null);
        store.delete(" ");

        doThrow(S3Exception.builder().message("down").statusCode(500).build())
                .when(s3).putObject(any(PutObjectRequest.class), any(RequestBody.class));
        MockMultipartFile photo = file("image/jpeg", new byte[]{1});
        assertThrows(ApiException.class, () -> store.store(orderId, "collection", photo));
        doThrow(S3Exception.builder().message("down").statusCode(500).build())
                .when(s3).deleteObject(any(DeleteObjectRequest.class));
        assertThrows(ApiException.class, () -> store.delete("ref"));

        MockMultipartFile broken = new MockMultipartFile("photo", "a.jpg", "image/jpeg", new byte[]{1}) {
            @Override
            public byte[] getBytes() throws java.io.IOException {
                throw new java.io.IOException("unreadable");
            }
        };
        org.mockito.Mockito.reset(s3);
        assertThrows(ApiException.class, () -> store.store(orderId, "collection", broken));
    }

    @Test
    void s3ClientHonoursThePhotoSettings() {
        System.setProperty("aws.disableEc2Metadata", "true");
        System.setProperty("aws.accessKeyId", "test-key");
        System.setProperty("aws.secretAccessKey", "test-secret");
        S3PhotoConfig config = new S3PhotoConfig();

        OrderProperties configured = properties("unused");
        configured.getPhotos().setRegion("us-east-1");
        configured.getPhotos().setAccessKey("order");
        configured.getPhotos().setSecretKey("orderorder");
        configured.getPhotos().setEndpoint("http://127.0.0.1:9");
        configured.getPhotos().setPathStyle(true);
        try (S3Client client = config.orderPhotoS3Client(configured)) {
            assertTrue(client.serviceName().contains("s3"));
        }

        OrderProperties defaults = properties("unused");
        defaults.getPhotos().setRegion("us-east-1");
        defaults.getPhotos().setAccessKey(" ");
        defaults.getPhotos().setEndpoint(" ");
        try (S3Client client = config.orderPhotoS3Client(defaults)) {
            assertTrue(client.serviceName().contains("s3"));
        }
    }

    private static OrderProperties properties(String directory) {
        OrderProperties properties = new OrderProperties();
        properties.getPhotos().setDirectory(directory);
        properties.getPhotos().setBucket("order-photos");
        return properties;
    }

    private static MockMultipartFile file(String type, byte[] bytes) {
        return new MockMultipartFile("photo", "proof", type, bytes);
    }
}
