package sg.edu.nus.cs3219.order.photo;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import sg.edu.nus.cs3219.order.config.OrderProperties;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.checksums.RequestChecksumCalculation;
import software.amazon.awssdk.core.checksums.ResponseChecksumValidation;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3ClientBuilder;
import software.amazon.awssdk.services.s3.S3Configuration;

import java.net.URI;

@Configuration
@ConditionalOnProperty(name = "order.photos.mode", havingValue = "s3")
public class S3PhotoConfig {

    @Bean(destroyMethod = "close")
    public S3Client orderPhotoS3Client(OrderProperties properties) {
        OrderProperties.Photos photos = properties.getPhotos();
        S3ClientBuilder builder = S3Client.builder()
                .region(Region.of(photos.getRegion()))
                .requestChecksumCalculation(RequestChecksumCalculation.WHEN_REQUIRED)
                .responseChecksumValidation(ResponseChecksumValidation.WHEN_REQUIRED)
                .serviceConfiguration(S3Configuration.builder()
                        .pathStyleAccessEnabled(photos.isPathStyle())
                        .build());
        if (photos.getAccessKey() != null && !photos.getAccessKey().isBlank()) {
            builder.credentialsProvider(StaticCredentialsProvider.create(
                    AwsBasicCredentials.create(photos.getAccessKey(), photos.getSecretKey())));
        }
        if (photos.getEndpoint() != null && !photos.getEndpoint().isBlank()) {
            builder.endpointOverride(URI.create(photos.getEndpoint()));
        }
        return builder.build();
    }
}
