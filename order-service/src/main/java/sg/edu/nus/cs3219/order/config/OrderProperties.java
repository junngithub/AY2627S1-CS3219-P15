package sg.edu.nus.cs3219.order.config;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.time.Duration;

@Validated
@ConfigurationProperties(prefix = "order")
public class OrderProperties {

    @Valid
    private final Api api = new Api();
    private final Photos photos = new Photos();
    private final Ranking ranking = new Ranking();
    private final Deadlines deadlines = new Deadlines();
    private final Clients clients = new Clients();
    private final Kafka kafka = new Kafka();

    public Api getApi() {
        return api;
    }

    public Photos getPhotos() {
        return photos;
    }

    public Ranking getRanking() {
        return ranking;
    }

    public Deadlines getDeadlines() {
        return deadlines;
    }

    public Clients getClients() {
        return clients;
    }

    public Kafka getKafka() {
        return kafka;
    }

    public static class Api {
        @NotBlank
        private String basePath;

        public String getBasePath() {
            return basePath;
        }

        public void setBasePath(String basePath) {
            this.basePath = basePath;
        }
    }

    public static class Photos {
        private String mode = "file";
        private String directory = "./data/photos";
        private String bucket = "order-photos";
        private String endpoint = "";
        private String region = "us-east-1";
        private String accessKey = "";
        private String secretKey = "";
        private boolean pathStyle = true;

        public String getMode() {
            return mode;
        }

        public void setMode(String mode) {
            this.mode = mode;
        }

        public String getDirectory() {
            return directory;
        }

        public void setDirectory(String directory) {
            this.directory = directory;
        }

        public String getBucket() {
            return bucket;
        }

        public void setBucket(String bucket) {
            this.bucket = bucket;
        }

        public String getEndpoint() {
            return endpoint;
        }

        public void setEndpoint(String endpoint) {
            this.endpoint = endpoint;
        }

        public String getRegion() {
            return region;
        }

        public void setRegion(String region) {
            this.region = region;
        }

        public String getAccessKey() {
            return accessKey;
        }

        public void setAccessKey(String accessKey) {
            this.accessKey = accessKey;
        }

        public String getSecretKey() {
            return secretKey;
        }

        public void setSecretKey(String secretKey) {
            this.secretKey = secretKey;
        }

        public boolean isPathStyle() {
            return pathStyle;
        }

        public void setPathStyle(boolean pathStyle) {
            this.pathStyle = pathStyle;
        }
    }

    public static class Ranking {
        private double radiusKm = 5;

        public double getRadiusKm() {
            return radiusKm;
        }

        public void setRadiusKm(double radiusKm) {
            this.radiusKm = radiusKm;
        }
    }

    public static class Deadlines {
        private Duration sweepInterval = Duration.ofSeconds(5);
        private Duration collectionWindow = Duration.ofMinutes(5);
        private Duration acknowledgementWindow = Duration.ofDays(1);
        private Duration completionWindow = Duration.ofDays(7);

        public Duration getSweepInterval() {
            return sweepInterval;
        }

        public void setSweepInterval(Duration sweepInterval) {
            this.sweepInterval = sweepInterval;
        }

        public Duration getCollectionWindow() {
            return collectionWindow;
        }

        public void setCollectionWindow(Duration collectionWindow) {
            this.collectionWindow = collectionWindow;
        }

        public Duration getAcknowledgementWindow() {
            return acknowledgementWindow;
        }

        public void setAcknowledgementWindow(Duration acknowledgementWindow) {
            this.acknowledgementWindow = acknowledgementWindow;
        }

        public Duration getCompletionWindow() {
            return completionWindow;
        }

        public void setCompletionWindow(Duration completionWindow) {
            this.completionWindow = completionWindow;
        }
    }

    public static class Clients {
        private Duration timeout = Duration.ofSeconds(2);
        private String userBaseUrl = "http://user-service:8080";
        private String creditBaseUrl = "http://credit-service:8080";
        private String supplierBaseUrl = "http://supplier-service:8080";
        private String ratingBaseUrl = "http://rating-service:8080";
        private String adminBaseUrl = "http://admin-service:8080";

        public Duration getTimeout() {
            return timeout;
        }

        public void setTimeout(Duration timeout) {
            this.timeout = timeout;
        }

        public String getUserBaseUrl() {
            return userBaseUrl;
        }

        public void setUserBaseUrl(String userBaseUrl) {
            this.userBaseUrl = userBaseUrl;
        }

        public String getCreditBaseUrl() {
            return creditBaseUrl;
        }

        public void setCreditBaseUrl(String creditBaseUrl) {
            this.creditBaseUrl = creditBaseUrl;
        }

        public String getSupplierBaseUrl() {
            return supplierBaseUrl;
        }

        public void setSupplierBaseUrl(String supplierBaseUrl) {
            this.supplierBaseUrl = supplierBaseUrl;
        }

        public String getRatingBaseUrl() {
            return ratingBaseUrl;
        }

        public void setRatingBaseUrl(String ratingBaseUrl) {
            this.ratingBaseUrl = ratingBaseUrl;
        }

        public String getAdminBaseUrl() {
            return adminBaseUrl;
        }

        public void setAdminBaseUrl(String adminBaseUrl) {
            this.adminBaseUrl = adminBaseUrl;
        }
    }

    public static class Kafka {
        private int replicas = 1;
        private int partitions = 3;

        public int getReplicas() {
            return replicas;
        }

        public void setReplicas(int replicas) {
            this.replicas = replicas;
        }

        public int getPartitions() {
            return partitions;
        }

        public void setPartitions(int partitions) {
            this.partitions = partitions;
        }
    }
}
