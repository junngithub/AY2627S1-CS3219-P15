package sg.edu.nus.cs3219.order.domain;

import java.util.Comparator;
import java.util.List;

public final class ProximityRanker {

    private ProximityRanker() {
    }

    public static List<RankedOrder> rank(List<RankedOrder> orders, Double latitude, Double longitude) {
        if (latitude == null || longitude == null) {
            return orders.stream()
                    .sorted(Comparator.comparingInt(RankedOrder::amount).reversed()
                            .thenComparing(RankedOrder::requestTimeEpoch, Comparator.reverseOrder()))
                    .toList();
        }
        return orders.stream()
                .sorted(Comparator
                        .comparingDouble((RankedOrder order) -> distanceKm(latitude, longitude, order.pickupLat(), order.pickupLng()))
                        .thenComparing(Comparator.comparingInt(RankedOrder::amount).reversed()))
                .toList();
    }

    public static double distanceKm(double lat1, double lng1, double lat2, double lng2) {
        double earthRadiusKm = 6371.0;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    public static BoundingBox box(double latitude, double longitude, double radiusKm) {
        double latDelta = radiusKm / 111.0;
        double lngScale = Math.cos(Math.toRadians(latitude));
        double lngDelta = lngScale < 0.01 ? radiusKm / 111.0 : radiusKm / (111.0 * lngScale);
        return new BoundingBox(latitude - latDelta, latitude + latDelta, longitude - lngDelta, longitude + lngDelta);
    }

    public record RankedOrder(String id, int amount, double pickupLat, double pickupLng, long requestTimeEpoch) {
    }

    public record BoundingBox(double minLat, double maxLat, double minLng, double maxLng) {
    }
}
