/**
 * AI Assistance Disclosure
 * Tool: Cursor (Auto), date: 2026-10-15
 * Scope: Implementation assistance for Order Service tests under author-fixed requirements and architecture.
 * Author review: Varun Sivakumar generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.
 */

package sg.edu.nus.cs3219.order.persistence;

import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DeliveryPointPersistenceTest {

    @Test
    void deliveryPointEntityRoundTripsFieldsAndSeedFlag() {
        DeliveryPointEntity point = new DeliveryPointEntity();
        point.setId(3L);
        point.setCode("com1");
        point.setName("COM1");
        point.setBuilding("COM1");
        point.setDescription("Lobby");
        point.setLatitude(1.29);
        point.setLongitude(103.77);
        point.setActive(false);

        assertEquals(3L, point.getId());
        assertEquals("com1", point.getCode());
        assertTrue(point.isSeed());
        assertEquals("COM1", point.getName());
        assertEquals("COM1", point.getBuilding());
        assertEquals("Lobby", point.getDescription());
        assertEquals(1.29, point.getLatitude());
        assertEquals(103.77, point.getLongitude());
        assertFalse(point.isActive());

        point.setCode(" ");
        assertFalse(point.isSeed());
        point.setCode(null);
        assertFalse(point.isSeed());
    }

    @Test
    void userDeliveryPointIdEqualsHashAndAccessors() {
        UserDeliveryPointId left = new UserDeliveryPointId("u1", 2L);
        UserDeliveryPointId right = new UserDeliveryPointId();
        right.setUserId("u1");
        right.setDeliveryPointId(2L);

        assertEquals(left, right);
        assertEquals(left.hashCode(), right.hashCode());
        assertEquals("u1", left.getUserId());
        assertEquals(2L, left.getDeliveryPointId());
        assertEquals(left, left);
        assertNotEquals(null, left);
        assertNotEquals("u1", left);
        assertNotEquals(new UserDeliveryPointId("u2", 2L), left);
        assertNotEquals(new UserDeliveryPointId("u1", 3L), left);
    }

    @Test
    void userDeliveryPointEntityRoundTripsUsage() {
        Instant now = Instant.parse("2026-10-02T04:00:00Z");
        UserDeliveryPointEntity row = new UserDeliveryPointEntity();
        row.setUserId("u1");
        row.setDeliveryPointId(4L);
        row.setUseCount(2);
        row.setNickname("Home");
        row.setLastUsedAt(now);
        row.setCreatedAt(now);

        assertEquals("u1", row.getUserId());
        assertEquals(4L, row.getDeliveryPointId());
        assertEquals(2, row.getUseCount());
        assertEquals("Home", row.getNickname());
        assertEquals(now, row.getLastUsedAt());
        assertEquals(now, row.getCreatedAt());
    }
}
