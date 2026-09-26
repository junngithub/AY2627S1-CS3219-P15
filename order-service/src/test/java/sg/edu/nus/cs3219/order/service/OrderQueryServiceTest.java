package sg.edu.nus.cs3219.order.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import sg.edu.nus.cs3219.order.client.Place;
import sg.edu.nus.cs3219.order.client.SupplierClient;
import sg.edu.nus.cs3219.order.client.UserAccount;
import sg.edu.nus.cs3219.order.client.UserClient;
import sg.edu.nus.cs3219.order.config.OrderProperties;
import sg.edu.nus.cs3219.order.domain.OrderStatus;
import sg.edu.nus.cs3219.order.persistence.AlertEntity;
import sg.edu.nus.cs3219.order.persistence.AlertRepository;
import sg.edu.nus.cs3219.order.persistence.OrderEntity;
import sg.edu.nus.cs3219.order.persistence.OrderRepository;
import sg.edu.nus.cs3219.order.rest.AlertResponse;
import sg.edu.nus.cs3219.order.rest.ApiException;
import sg.edu.nus.cs3219.order.rest.PageResponse;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class OrderQueryServiceTest {

    private final UUID id = UUID.fromString("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private final Instant now = Instant.parse("2026-10-02T04:00:00Z");

    @Mock private OrderRepository orders;
    @Mock private AlertRepository alerts;
    @Mock private UserClient users;
    @Mock private SupplierClient suppliers;

    private OrderQueryService service;

    @BeforeEach
    void setUp() {
        service = new OrderQueryService(orders, alerts, users, suppliers, new OrderProperties());
        when(users.authenticate(any())).thenReturn(new UserAccount("courier@u.nus.edu", "courier@u.nus.edu", "courier"));
    }

    @Test
    void getIsLimitedToTheRequesterAndAssignedCourier() {
        OrderEntity order = order();
        order.setCourierEmail("courier@u.nus.edu");
        when(orders.findById(id)).thenReturn(Optional.of(order));
        assertEquals(id, service.get("auth", id).getId());

        when(users.authenticate(any())).thenReturn(new UserAccount("requester@u.nus.edu", "requester@u.nus.edu", "requester"));
        assertEquals("requester@u.nus.edu", service.get("auth", id).getRequesterEmail());

        when(users.authenticate(any())).thenReturn(new UserAccount("other@u.nus.edu", "other@u.nus.edu", "other"));
        assertThrows(ApiException.class, () -> service.get("auth", id));

        when(orders.findById(id)).thenReturn(Optional.empty());
        assertThrows(ApiException.class, () -> service.get("auth", id));
    }

    @Test
    void poolRanksNearbyOrdersAndFallsBackToReward() {
        when(orders.findOpenInBox(eq(OrderStatus.CREATED), eq("courier@u.nus.edu"), anyDouble(), anyDouble(), anyDouble(), anyDouble()))
                .thenReturn(List.of(order()));
        PageResponse<OrderEntity> nearby = service.pool("auth", 1.2968, 103.7733, 0, 20);
        assertEquals(1, nearby.content().size());
        assertTrue(service.pool("auth", 1.2968, 103.7733, 1, 20).content().isEmpty());

        when(orders.searchOpen(eq(OrderStatus.CREATED), eq("courier@u.nus.edu"), isNull(), isNull(), any()))
                .thenReturn(new PageImpl<>(List.of(order()), PageRequest.of(0, 20), 1));
        assertEquals(1, service.pool("auth", null, 1.0, 0, 20).totalElements());
        assertTrue(service.pool("auth", null, null, 0, 0).content().isEmpty());
        assertThrows(ApiException.class, () -> service.pool("auth", null, null, -1, 20));
        assertThrows(ApiException.class, () -> service.pool("auth", null, null, 0, 1001));
    }

    @Test
    void mineSearchAndAlertsPageTheCallersRows() {
        when(users.authenticate(any())).thenReturn(new UserAccount("requester@u.nus.edu", "requester@u.nus.edu", "requester"));
        when(orders.findByRequesterEmailOrderByRequestTimeDesc(eq("requester@u.nus.edu"), any()))
                .thenReturn(new PageImpl<>(List.of(order())));
        assertEquals(1, service.mine("auth", 0, 20).content().size());
        assertTrue(service.mine("auth", 0, 0).content().isEmpty());

        when(suppliers.requirePlace(eq("nus-coop"), any())).thenReturn(new Place("nus-coop", "NUS Co-op", 1.0, 103.0));
        when(suppliers.requirePlace(eq("cool-spot"), any())).thenReturn(new Place("cool-spot", "Cool Spot", 1.0, 103.0));
        when(orders.searchOpen(eq(OrderStatus.CREATED), eq("requester@u.nus.edu"), eq("nus-coop"), eq("cool-spot"), any()))
                .thenReturn(new PageImpl<>(List.of(order())));
        when(orders.searchOpen(eq(OrderStatus.CREATED), eq("requester@u.nus.edu"), isNull(), eq("cool-spot"), any()))
                .thenReturn(new PageImpl<>(List.of()));
        assertEquals(1, service.search("auth", "nus-coop", "cool-spot", 0, 20).content().size());
        assertTrue(service.search("auth", " ", "cool-spot", 0, 20).content().isEmpty());
        assertTrue(service.search("auth", "nus-coop", "cool-spot", 0, 0).content().isEmpty());
        assertThrows(ApiException.class, () -> service.search("auth", " ", null, 0, 20));
        assertThrows(ApiException.class, () -> service.search("auth", "nus-coop", "cool-spot", 0, -1));

        AlertEntity alert = new AlertEntity();
        alert.setId(UUID.randomUUID());
        alert.setOrderId(id);
        alert.setRequesterEmail("requester@u.nus.edu");
        alert.setFromStatus("CREATED");
        alert.setToStatus("ACCEPTED");
        alert.setNotifyRequester(true);
        alert.setCreatedAt(now);
        when(alerts.findByRequesterEmailAndNotifyRequesterTrueOrderByCreatedAtDesc(eq("requester@u.nus.edu"), any()))
                .thenReturn(new PageImpl<>(List.of(alert)));
        PageResponse<AlertEntity> page = service.alerts("auth", 0, 20);
        AlertResponse response = AlertResponse.from(page.content().getFirst());
        assertEquals("ACCEPTED", response.toStatus());
        assertEquals("requester@u.nus.edu", alert.getRequesterEmail());
        assertTrue(alert.isNotifyRequester());
        assertTrue(service.alerts("auth", 0, 0).content().isEmpty());
    }

    private OrderEntity order() {
        OrderEntity order = new OrderEntity();
        order.setId(id);
        order.setRequesterEmail("requester@u.nus.edu");
        order.setAmount(8);
        order.setStatus(OrderStatus.CREATED);
        order.setRequestTime(now);
        order.setPickupLat(1.2968);
        order.setPickupLng(103.7733);
        return order;
    }
}
