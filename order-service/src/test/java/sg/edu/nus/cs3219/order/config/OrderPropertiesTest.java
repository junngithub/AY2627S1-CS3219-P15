/**
 * AI Assistance Disclosure
 * Tool: Cursor (Auto), date: 2026-10-15
 * Scope: Implementation assistance for Order Service tests under author-fixed requirements and architecture.
 * Author review: Varun Sivakumar generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.
 */

package sg.edu.nus.cs3219.order.config;

import org.junit.jupiter.api.Test;
import org.springframework.web.servlet.config.annotation.PathMatchConfigurer;
import sg.edu.nus.cs3219.order.domain.OrderStateMachine;
import sg.edu.nus.cs3219.order.domain.ProximityRanker;
import sg.edu.nus.cs3219.order.messaging.KafkaTopics;
import sg.edu.nus.cs3219.order.rest.OpenApiConfig;

import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.time.Duration;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OrderPropertiesTest {

    @Test
    void configurationExposesServiceAndDeadlineOverrides() {
        OrderProperties properties = configured();

        assertEquals("/configured", properties.getApi().getBasePath());
        assertEquals("s3", properties.getPhotos().getMode());
        assertEquals("order-photos", properties.getPhotos().getBucket());
        assertEquals("http://minio:9000", properties.getPhotos().getEndpoint());
        assertEquals("ap-southeast-1", properties.getPhotos().getRegion());
        assertEquals("order", properties.getPhotos().getAccessKey());
        assertEquals("orderorder", properties.getPhotos().getSecretKey());
        assertEquals(false, properties.getPhotos().isPathStyle());
        assertEquals(2, properties.getRanking().getRadiusKm());
        assertEquals(Duration.ofSeconds(5), properties.getDeadlines().getSweepInterval());
        assertEquals(Duration.ofMinutes(5), properties.getDeadlines().getCollectionWindow());
        assertEquals(Duration.ofDays(1), properties.getDeadlines().getAcknowledgementWindow());
        assertEquals(Duration.ofDays(7), properties.getDeadlines().getCompletionWindow());
        assertEquals(Duration.ofSeconds(2), properties.getClients().getTimeout());
        assertTrue(properties.getClients().getUserBaseUrl().contains("8080"));
        assertTrue(properties.getClients().getCreditBaseUrl().contains("8080"));
        assertTrue(properties.getClients().getSupplierBaseUrl().contains("8080"));
        assertTrue(properties.getClients().getRatingBaseUrl().contains("8085"));
        assertTrue(properties.getClients().getAdminBaseUrl().contains("8080"));
        assertEquals(1, properties.getKafka().getReplicas());
        assertEquals(3, properties.getKafka().getPartitions());
        assertNotNull(new ClockConfig().clock());
        assertEquals("Order Service", new OpenApiConfig().orderServiceOpenAPI().getInfo().getTitle());
    }

    @Test
    void configurationExposesDeliveryBoundsAndUtilityTypes() throws Exception {
        OrderProperties properties = configured();

        assertEquals(1.288, properties.getDeliveryPoints().getMinLat());
        assertEquals(1.309, properties.getDeliveryPoints().getMaxLat());
        assertEquals(103.766, properties.getDeliveryPoints().getMinLng());
        assertEquals(103.788, properties.getDeliveryPoints().getMaxLng());
        construct(OrderStateMachine.class);
        construct(ProximityRanker.class);
        construct(KafkaTopics.class);
        construct(Class.forName("sg.edu.nus.cs3219.order.photo.PhotoRules"));

        PathMatchConfigurer configurer = new PathMatchConfigurer();
        new ApiPathConfig(properties).configurePathMatch(configurer);
        Field prefixes = PathMatchConfigurer.class.getDeclaredField("pathPrefixes");
        prefixes.setAccessible(true);
        assertTrue(((Map<?, ?>) prefixes.get(configurer)).containsKey("/configured"));
    }

    private static OrderProperties configured() {
        OrderProperties properties = new OrderProperties();
        properties.getPhotos().setMode("s3");
        properties.getPhotos().setBucket("order-photos");
        properties.getPhotos().setEndpoint("http://minio:9000");
        properties.getPhotos().setRegion("ap-southeast-1");
        properties.getPhotos().setAccessKey("order");
        properties.getPhotos().setSecretKey("orderorder");
        properties.getPhotos().setPathStyle(false);
        properties.getRanking().setRadiusKm(2);
        properties.getDeadlines().setSweepInterval(Duration.ofSeconds(5));
        properties.getDeadlines().setCollectionWindow(Duration.ofMinutes(5));
        properties.getDeadlines().setAcknowledgementWindow(Duration.ofDays(1));
        properties.getDeadlines().setCompletionWindow(Duration.ofDays(7));
        properties.getClients().setTimeout(Duration.ofSeconds(2));
        properties.getClients().setUserBaseUrl("http://user-service:8080");
        properties.getClients().setCreditBaseUrl("http://credit-service:8080");
        properties.getClients().setSupplierBaseUrl("http://supplier-service:8080");
        properties.getClients().setRatingBaseUrl("http://rating-service:8085");
        properties.getClients().setAdminBaseUrl("http://admin-service:8080");
        properties.getKafka().setReplicas(1);
        properties.getKafka().setPartitions(3);
        properties.getApi().setBasePath("/configured");
        properties.getDeliveryPoints().setMinLat(1.288);
        properties.getDeliveryPoints().setMaxLat(1.309);
        properties.getDeliveryPoints().setMinLng(103.766);
        properties.getDeliveryPoints().setMaxLng(103.788);
        return properties;
    }

    private static void construct(Class<?> type) throws Exception {
        Constructor<?> constructor = type.getDeclaredConstructor();
        constructor.setAccessible(true);
        constructor.newInstance();
    }
}
