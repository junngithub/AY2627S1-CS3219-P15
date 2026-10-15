package sg.edu.nus.cs3219.order.config;

import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.Bindable;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.boot.kafka.autoconfigure.KafkaProperties;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.ClassPathResource;
import org.springframework.mock.env.MockEnvironment;

import java.io.IOException;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

// application-k8s.yml, resolved against the env the foc-service Helm chart sets.
class KubernetesProfileTest {

    @Test
    void kafkaClientsUseTheTlsListenerWithScram() throws IOException {
        KafkaProperties kafka = k8sProfile(chartEnv()).bind("spring.kafka", KafkaProperties.class).get();

        List<Map<String, Object>> clients = List.of(
                kafka.buildProducerProperties(),
                kafka.buildConsumerProperties(),
                kafka.buildAdminProperties()
        );
        for (Map<String, Object> client : clients) {
            assertEquals(List.of("kafka-kafka-bootstrap:9093"), client.get("bootstrap.servers"));
            assertEquals("SASL_SSL", client.get("security.protocol"));
            assertEquals("SCRAM-SHA-512", client.get("sasl.mechanism"));
            assertEquals(
                    "org.apache.kafka.common.security.scram.ScramLoginModule required username=\"order\" password=\"kafka-pw\";",
                    client.get("sasl.jaas.config")
            );
            assertEquals("PEM", client.get("ssl.truststore.type"));
            assertEquals("/etc/kafka/ca/ca.crt", client.get("ssl.truststore.location"));
        }
        assertFalse(kafka.getAdmin().isAutoCreate());
    }

    @Test
    void datasourceComesFromTheDatabaseSecret() throws IOException {
        Binder binder = k8sProfile(chartEnv());
        assertEquals(
                "jdbc:postgresql://172.19.0.2:7001/local_order?sslmode=require",
                binder.bind("spring.datasource.url", String.class).get()
        );
        assertEquals("local_order", binder.bind("spring.datasource.username", String.class).get());
        assertEquals("db-pw", binder.bind("spring.datasource.password", String.class).get());

        Binder local = k8sProfile(chartEnv().withProperty("PGSSLMODE", "disable"));
        assertEquals(
                "jdbc:postgresql://172.19.0.2:7001/local_order?sslmode=disable",
                local.bind("spring.datasource.url", String.class).get()
        );
    }

    @Test
    void healthIsAlsoServedAtThePlatformsHealthPath() throws IOException {
        // Every FoC service answers GET /health: the chart's probes, and peers'
        // `helm test` checks of their *_SERVICE_URL, call it.
        Binder binder = k8sProfile(chartEnv());
        String group = "management.endpoint.health.group.platform.";
        assertEquals("server:/health", binder.bind(group + "additional-path", String.class).get());
        assertEquals(List.of("*"), binder.bind(group + "include", Bindable.listOf(String.class)).get());
    }

    @Test
    void photosAreStoredInTheImagesPhotoDirectory() throws IOException {
        OrderProperties properties = k8sProfile(chartEnv()).bind("order", OrderProperties.class).get();
        assertEquals("file", properties.getPhotos().getMode());
        assertEquals("/app/photos", properties.getPhotos().getDirectory());
    }

    private static MockEnvironment chartEnv() {
        return new MockEnvironment()
                .withProperty("KAFKA_BROKERS", "kafka-kafka-bootstrap:9093")
                .withProperty("KAFKA_SASL_MECHANISM", "SCRAM-SHA-512")
                .withProperty("KAFKA_USERNAME", "order")
                .withProperty("KAFKA_PASSWORD", "kafka-pw")
                .withProperty("KAFKA_CA_CERT", "/etc/kafka/ca/ca.crt")
                .withProperty("PGHOST", "172.19.0.2")
                .withProperty("PGPORT", "7001")
                .withProperty("PGDATABASE", "local_order")
                .withProperty("PGUSER", "local_order")
                .withProperty("PGPASSWORD", "db-pw");
    }

    private static Binder k8sProfile(MockEnvironment environment) throws IOException {
        List<PropertySource<?>> sources = new YamlPropertySourceLoader()
                .load("application-k8s.yml", new ClassPathResource("application-k8s.yml"));
        sources.forEach(environment.getPropertySources()::addLast);
        return Binder.get(environment);
    }
}
