package sg.edu.nus.cs3219.order.domain;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ProximityRankerTest {

    @Test
    void closerPickupRanksAheadOfAHigherReward() {
        ProximityRanker.RankedOrder near = new ProximityRanker.RankedOrder("near", 1, 1.2964, 103.7730, 1);
        ProximityRanker.RankedOrder far = new ProximityRanker.RankedOrder("far", 50, 1.3100, 103.7900, 2);
        List<ProximityRanker.RankedOrder> ranked = ProximityRanker.rank(List.of(far, near), 1.2964, 103.7730);
        assertEquals("near", ranked.getFirst().id());
    }

    @Test
    void equalDistanceBreaksTiesByReward() {
        ProximityRanker.RankedOrder low = new ProximityRanker.RankedOrder("low", 2, 1.30, 103.80, 1);
        ProximityRanker.RankedOrder high = new ProximityRanker.RankedOrder("high", 9, 1.30, 103.80, 2);
        List<ProximityRanker.RankedOrder> ranked = ProximityRanker.rank(List.of(low, high), 1.30, 103.80);
        assertEquals("high", ranked.getFirst().id());
    }

    @Test
    void missingCoordinatesSortByRewardOnly() {
        ProximityRanker.RankedOrder low = new ProximityRanker.RankedOrder("low", 2, 1.0, 103.0, 3);
        ProximityRanker.RankedOrder high = new ProximityRanker.RankedOrder("high", 9, 1.4, 103.9, 1);
        List<ProximityRanker.RankedOrder> ranked = ProximityRanker.rank(List.of(low, high), null, null);
        assertEquals("high", ranked.getFirst().id());
        assertEquals("high", ProximityRanker.rank(List.of(low, high), 1.4, null).getFirst().id());
    }

    @Test
    void boundingBoxShrinksNearThePole() {
        ProximityRanker.BoundingBox equator = ProximityRanker.box(0, 103.0, 5);
        ProximityRanker.BoundingBox pole = ProximityRanker.box(89.9, 103.0, 5);
        assertTrue(equator.maxLat() > equator.minLat());
        assertTrue(pole.maxLng() - pole.minLng() >= equator.maxLng() - equator.minLng());
        assertEquals(0, ProximityRanker.distanceKm(1, 103, 1, 103), 0.001);
    }
}
