package sg.edu.nus.cs3219.order.service;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import sg.edu.nus.cs3219.order.client.SupplierClient;
import sg.edu.nus.cs3219.order.client.UserAccount;
import sg.edu.nus.cs3219.order.config.OrderProperties;
import sg.edu.nus.cs3219.order.domain.OrderStatus;
import sg.edu.nus.cs3219.order.domain.ProximityRanker;
import sg.edu.nus.cs3219.order.persistence.AlertEntity;
import sg.edu.nus.cs3219.order.persistence.AlertRepository;
import sg.edu.nus.cs3219.order.persistence.OrderEntity;
import sg.edu.nus.cs3219.order.persistence.OrderRepository;
import sg.edu.nus.cs3219.order.rest.ApiException;
import sg.edu.nus.cs3219.order.rest.PageResponse;

import java.util.List;
import java.util.UUID;

@Service
public class OrderQueryService {

    private final OrderRepository orders;
    private final AlertRepository alerts;
    private final SupplierClient suppliers;
    private final OrderProperties properties;

    public OrderQueryService(
            OrderRepository orders,
            AlertRepository alerts,
            SupplierClient suppliers,
            OrderProperties properties
    ) {
        this.orders = orders;
        this.alerts = alerts;
        this.suppliers = suppliers;
        this.properties = properties;
    }

    @Transactional(readOnly = true)
    public OrderEntity get(UserAccount actor, UUID orderId) {
        OrderEntity order = orders.findById(orderId).orElseThrow(() -> ApiException.notFound("Order not found"));
        boolean requester = order.getRequesterId().equalsIgnoreCase(actor.userId());
        boolean courier = order.getCourierId() != null && order.getCourierId().equalsIgnoreCase(actor.userId());
        if (!requester && !courier) {
            throw ApiException.notFound("Order not found");
        }
        return order;
    }

    @Transactional(readOnly = true)
    public PageResponse<OrderEntity> pool(UserAccount actor, Double latitude, Double longitude, int page, int size) {
        requirePage(page, size);
        if (size == 0) {
            return PageResponse.empty(page, size);
        }
        if (latitude == null || longitude == null) {
            Page<OrderEntity> result = orders.searchOpen(
                    OrderStatus.CREATED,
                    actor.userId(),
                    null,
                    null,
                    PageRequest.of(page, size, Sort.by(Sort.Order.desc("amount"), Sort.Order.desc("requestTime")))
            );
            return PageResponse.of(result.getContent(), page, size, result.getTotalElements());
        }
        ProximityRanker.BoundingBox box = ProximityRanker.box(latitude, longitude, properties.getRanking().getRadiusKm());
        List<OrderEntity> candidates = orders.findOpenInBox(
                OrderStatus.CREATED,
                actor.userId(),
                box.minLat(),
                box.maxLat(),
                box.minLng(),
                box.maxLng()
        );
        List<ProximityRanker.RankedOrder> ranked = ProximityRanker.rank(candidates.stream()
                .map(order -> new ProximityRanker.RankedOrder(
                        order.getId().toString(),
                        order.getAmount(),
                        order.getPickupLat(),
                        order.getPickupLng(),
                        order.getRequestTime().toEpochMilli()))
                .toList(), latitude, longitude);
        return slice(candidates, ranked, page, size);
    }

    @Transactional(readOnly = true)
    public PageResponse<OrderEntity> mine(UserAccount actor, int page, int size) {
        requirePage(page, size);
        if (size == 0) {
            return PageResponse.empty(page, size);
        }
        Page<OrderEntity> result = orders.findByRequesterIdOrderByRequestTimeDesc(
                actor.userId(),
                PageRequest.of(page, size)
        );
        return PageResponse.of(result.getContent(), page, size, result.getTotalElements());
    }

    @Transactional(readOnly = true)
    public PageResponse<OrderEntity> search(UserAccount actor, String pickupLocationId, String dropoffLocationId, int page, int size) {
        requirePage(page, size);
        if ((pickupLocationId == null || pickupLocationId.isBlank()) && (dropoffLocationId == null || dropoffLocationId.isBlank())) {
            throw ApiException.badRequest("Provide a pickup location or a dropoff location");
        }
        if (pickupLocationId != null && !pickupLocationId.isBlank()) {
            suppliers.requirePlace(pickupLocationId, actor);
        }
        if (dropoffLocationId != null && !dropoffLocationId.isBlank()) {
            suppliers.requirePlace(dropoffLocationId, actor);
        }
        if (size == 0) {
            return PageResponse.empty(page, size);
        }
        Page<OrderEntity> result = orders.searchOpen(
                OrderStatus.CREATED,
                actor.userId(),
                blankToNull(pickupLocationId),
                blankToNull(dropoffLocationId),
                PageRequest.of(page, size, Sort.by(Sort.Order.desc("amount")))
        );
        return PageResponse.of(result.getContent(), page, size, result.getTotalElements());
    }

    @Transactional(readOnly = true)
    public PageResponse<AlertEntity> alerts(UserAccount actor, int page, int size) {
        requirePage(page, size);
        if (size == 0) {
            return PageResponse.empty(page, size);
        }
        Page<AlertEntity> result = alerts.findByRequesterIdAndNotifyRequesterTrueOrderByCreatedAtDesc(
                actor.userId(),
                PageRequest.of(page, size)
        );
        return PageResponse.of(result.getContent(), page, size, result.getTotalElements());
    }

    private PageResponse<OrderEntity> slice(List<OrderEntity> candidates, List<ProximityRanker.RankedOrder> ranked, int page, int size) {
        int from = page * size;
        if (from >= ranked.size()) {
            return PageResponse.empty(page, size, ranked.size());
        }
        int to = Math.min(from + size, ranked.size());
        List<OrderEntity> content = ranked.subList(from, to).stream()
                .map(item -> candidates.stream().filter(order -> order.getId().toString().equals(item.id())).findFirst().orElseThrow())
                .toList();
        return PageResponse.of(content, page, size, ranked.size());
    }

    private static void requirePage(int page, int size) {
        if (page < 0 || size < 0 || size > 1000) {
            throw ApiException.badRequest("Page size must be between 0 and 1000");
        }
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
