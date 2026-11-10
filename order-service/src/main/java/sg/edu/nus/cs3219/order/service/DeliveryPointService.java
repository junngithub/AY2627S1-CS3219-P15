/**
 * AI Assistance Disclosure
 * Tool: Cursor (Auto), date: 2026-10-15
 * Scope: Implementation assistance for Order Service application services under author-fixed requirements and architecture.
 * Author review: Varun Sivakumar generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.
 */

package sg.edu.nus.cs3219.order.service;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import sg.edu.nus.cs3219.order.client.UserAccount;
import sg.edu.nus.cs3219.order.config.OrderProperties;
import sg.edu.nus.cs3219.order.domain.PreparedDropoff;
import sg.edu.nus.cs3219.order.domain.ResolvedDropoff;
import sg.edu.nus.cs3219.order.persistence.DeliveryPointEntity;
import sg.edu.nus.cs3219.order.persistence.DeliveryPointRepository;
import sg.edu.nus.cs3219.order.persistence.ProcessedEventEntity;
import sg.edu.nus.cs3219.order.persistence.ProcessedEventRepository;
import sg.edu.nus.cs3219.order.persistence.UserDeliveryPointEntity;
import sg.edu.nus.cs3219.order.persistence.UserDeliveryPointRepository;
import sg.edu.nus.cs3219.order.rest.ApiException;
import sg.edu.nus.cs3219.order.rest.CreateOrderRequest;
import sg.edu.nus.cs3219.order.rest.DeliveryPointResponse;
import sg.edu.nus.cs3219.order.rest.PageResponse;
import sg.edu.nus.cs3219.order.rest.UpdateDeliveryPointRequest;

import java.time.Clock;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public class DeliveryPointService {

    private static final String POINT_NOT_FOUND = "Delivery point not found";

    private final DeliveryPointRepository points;
    private final UserDeliveryPointRepository associations;
    private final ProcessedEventRepository processedEvents;
    private final OrderProperties properties;
    private final Clock clock;

    public DeliveryPointService(
            DeliveryPointRepository points,
            UserDeliveryPointRepository associations,
            ProcessedEventRepository processedEvents,
            OrderProperties properties,
            Clock clock
    ) {
        this.points = points;
        this.associations = associations;
        this.processedEvents = processedEvents;
        this.properties = properties;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public PageResponse<DeliveryPointResponse> catalogue(int page, int size) {
        requirePage(page, size);
        if (size == 0) {
            return PageResponse.empty(page, size);
        }
        Page<DeliveryPointEntity> result = points.findByCodeIsNotNullAndActiveTrueOrderByIdAsc(PageRequest.of(page, size));
        return PageResponse.of(result.map(DeliveryPointResponse::from).getContent(), page, size, result.getTotalElements());
    }

    @Transactional(readOnly = true)
    public PageResponse<DeliveryPointResponse> myLocations(UserAccount actor, int page, int size) {
        requirePage(page, size);
        if (size == 0) {
            return PageResponse.empty(page, size);
        }
        Page<UserDeliveryPointEntity> result = associations.findByUserIdOrderByUseCountDescLastUsedAtDesc(
                actor.userId(),
                PageRequest.of(page, size)
        );
        List<Long> ids = result.getContent().stream().map(UserDeliveryPointEntity::getDeliveryPointId).toList();
        Map<Long, DeliveryPointEntity> byId = points.findActiveByIdIn(ids).stream()
                .collect(Collectors.toMap(DeliveryPointEntity::getId, Function.identity()));
        List<DeliveryPointResponse> content = result.getContent().stream()
                .filter(row -> byId.containsKey(row.getDeliveryPointId()))
                .map(row -> DeliveryPointResponse.from(
                        byId.get(row.getDeliveryPointId()),
                        row.getNickname(),
                        row.getUseCount(),
                        row.getLastUsedAt()))
                .toList();
        return PageResponse.of(content, page, size, result.getTotalElements());
    }

    @Transactional
    public DeliveryPointResponse update(UserAccount actor, long id, UpdateDeliveryPointRequest request) {
        requireAssociated(actor.userId(), id);
        DeliveryPointEntity locked = points.lockById(id).orElseThrow(() -> ApiException.notFound(POINT_NOT_FOUND));
        if (!locked.isActive()) {
            throw ApiException.badRequest("Delivery point is inactive");
        }
        UserDeliveryPointEntity mine = associations.findByUserIdAndDeliveryPointId(actor.userId(), id)
                .orElseThrow(() -> ApiException.notFound(POINT_NOT_FOUND));

        boolean placeChanged = request.name() != null
                || request.building() != null
                || request.description() != null
                || request.latitude() != null
                || request.longitude() != null;
        if (request.nickname() != null) {
            mine.setNickname(normalizeNickname(request.nickname()));
        }
        if (!placeChanged) {
            return DeliveryPointResponse.from(locked, mine.getNickname(), mine.getUseCount(), mine.getLastUsedAt());
        }

        String name = firstNonBlank(request.name(), locked.getName());
        String building = firstNonBlank(request.building(), locked.getBuilding());
        String description = firstNonBlank(request.description(), locked.getDescription());
        double latitude = request.latitude() == null ? locked.getLatitude() : request.latitude();
        double longitude = request.longitude() == null ? locked.getLongitude() : request.longitude();
        requireInsideBounds(latitude, longitude);

        long associationCount = associations.countByDeliveryPointId(id);
        if (locked.isSeed() || associationCount > 1) {
            DeliveryPointEntity fork = new DeliveryPointEntity();
            fork.setName(name);
            fork.setBuilding(building);
            fork.setDescription(description);
            fork.setLatitude(latitude);
            fork.setLongitude(longitude);
            fork.setActive(true);
            points.save(fork);

            associations.delete(mine);
            UserDeliveryPointEntity moved = new UserDeliveryPointEntity();
            moved.setUserId(actor.userId());
            moved.setDeliveryPointId(fork.getId());
            moved.setUseCount(mine.getUseCount());
            moved.setNickname(mine.getNickname());
            moved.setLastUsedAt(mine.getLastUsedAt());
            moved.setCreatedAt(mine.getCreatedAt());
            associations.save(moved);
            return DeliveryPointResponse.from(fork, moved.getNickname(), moved.getUseCount(), moved.getLastUsedAt());
        }

        locked.setName(name);
        locked.setBuilding(building);
        locked.setDescription(description);
        locked.setLatitude(latitude);
        locked.setLongitude(longitude);
        return DeliveryPointResponse.from(locked, mine.getNickname(), mine.getUseCount(), mine.getLastUsedAt());
    }

    @Transactional
    public void delete(UserAccount actor, long id) {
        requireAssociated(actor.userId(), id);
        DeliveryPointEntity locked = points.lockById(id).orElseThrow(() -> ApiException.notFound(POINT_NOT_FOUND));
        associations.findByUserIdAndDeliveryPointId(actor.userId(), id).ifPresent(associations::delete);
        if (!locked.isSeed() && associations.countByDeliveryPointId(id) == 0) {
            locked.setActive(false);
        }
    }

    @Transactional
    public void applyUserDeleted(String eventId, String userId) {
        if (eventId == null || eventId.isBlank() || userId == null || userId.isBlank()) {
            return;
        }
        if (processedEvents.existsById(eventId)) {
            return;
        }
        ProcessedEventEntity processed = new ProcessedEventEntity();
        processed.setEventId(eventId);
        processed.setProcessedAt(clock.instant());
        processedEvents.save(processed);

        List<UserDeliveryPointEntity> rows = associations.findByUserId(userId);
        Set<Long> pointIds = rows.stream()
                .map(UserDeliveryPointEntity::getDeliveryPointId)
                .collect(Collectors.toCollection(LinkedHashSet::new));
        associations.deleteAll(rows);
        for (Long pointId : pointIds) {
            points.lockById(pointId).ifPresent(point -> {
                if (!point.isSeed() && associations.countByDeliveryPointId(pointId) == 0) {
                    point.setActive(false);
                }
            });
        }
    }

    @Transactional(readOnly = true)
    public PreparedDropoff prepareForCreate(UserAccount requester, CreateOrderRequest request) {
        if (request.deliveryPointId() != null) {
            DeliveryPointEntity point = requireAllowedForCreate(requester.userId(), request.deliveryPointId());
            return new PreparedDropoff(
                    point.getId(),
                    point.getName(),
                    point.getBuilding(),
                    point.getDescription(),
                    point.getLatitude(),
                    point.getLongitude()
            );
        }
        String name = requireText(request.dropoffName(), "dropoffName");
        String building = requireText(request.dropoffBuilding(), "dropoffBuilding");
        String description = requireText(request.dropoffDescription(), "dropoffDescription");
        if (request.dropoffLat() == null || request.dropoffLng() == null) {
            throw ApiException.badRequest("dropoffLat and dropoffLng are required when deliveryPointId is omitted");
        }
        requireInsideBounds(request.dropoffLat(), request.dropoffLng());
        return new PreparedDropoff(null, name, building, description, request.dropoffLat(), request.dropoffLng());
    }

    @Transactional
    public ResolvedDropoff persistPrepared(PreparedDropoff prepared) {
        if (prepared.isExisting()) {
            return new ResolvedDropoff(
                    prepared.existingId(),
                    prepared.name(),
                    prepared.building(),
                    prepared.description(),
                    prepared.latitude(),
                    prepared.longitude()
            );
        }
        DeliveryPointEntity created = new DeliveryPointEntity();
        created.setName(prepared.name());
        created.setBuilding(prepared.building());
        created.setDescription(prepared.description());
        created.setLatitude(prepared.latitude());
        created.setLongitude(prepared.longitude());
        created.setActive(true);
        points.save(created);
        return new ResolvedDropoff(
                created.getId(),
                created.getName(),
                created.getBuilding(),
                created.getDescription(),
                created.getLatitude(),
                created.getLongitude()
        );
    }

    @Transactional
    public void recordSuccessfulUse(String userId, long deliveryPointId) {
        associations.upsertUsage(userId, deliveryPointId, clock.instant());
    }

    private DeliveryPointEntity requireAllowedForCreate(String userId, long id) {
        DeliveryPointEntity point = points.findById(id).orElseThrow(() -> ApiException.badRequest("Unknown delivery point"));
        if (!point.isActive()) {
            throw ApiException.badRequest("Delivery point is inactive");
        }
        if (point.isSeed() || associations.existsByUserIdAndDeliveryPointId(userId, id)) {
            return point;
        }
        throw ApiException.badRequest("You cannot use another user's delivery point");
    }

    private void requireAssociated(String userId, long id) {
        if (!associations.existsByUserIdAndDeliveryPointId(userId, id)) {
            throw ApiException.notFound(POINT_NOT_FOUND);
        }
    }

    private void requireInsideBounds(double latitude, double longitude) {
        OrderProperties.DeliveryPoints bounds = properties.getDeliveryPoints();
        if (latitude < bounds.getMinLat() || latitude > bounds.getMaxLat()
                || longitude < bounds.getMinLng() || longitude > bounds.getMaxLng()) {
            throw ApiException.badRequest("Dropoff must be inside the NUS campus bounds");
        }
    }

    private static void requirePage(int page, int size) {
        if (page < 0 || size < 0 || size > 100) {
            throw ApiException.badRequest("Page size must be between 0 and 100");
        }
    }

    private static String requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw ApiException.badRequest(field + " must not be blank");
        }
        return value.trim();
    }

    private static String firstNonBlank(String candidate, String fallback) {
        if (candidate == null || candidate.isBlank()) {
            return fallback;
        }
        return candidate.trim();
    }

    /** Blank clears; otherwise trimmed. Caller passes null to leave unchanged. */
    private static String normalizeNickname(String nickname) {
        if (nickname == null || nickname.isBlank()) {
            return null;
        }
        return nickname.trim();
    }
}
