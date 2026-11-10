/**
 * AI Assistance Disclosure
 * Tool: Cursor (Auto), date: 2026-10-15
 * Scope: Implementation assistance for Order Service tests under author-fixed requirements and architecture.
 * Author review: Varun Sivakumar generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.
 */

package sg.edu.nus.cs3219.order.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
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
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class DeliveryPointServiceTest {

    private final Instant now = Instant.parse("2026-10-02T04:00:00Z");
    private final UserAccount user = new UserAccount("11111111-1111-1111-1111-111111111111");

    @Mock private DeliveryPointRepository points;
    @Mock private UserDeliveryPointRepository associations;
    @Mock private ProcessedEventRepository processedEvents;

    private DeliveryPointService service;

    @BeforeEach
    void setUp() {
        service = new DeliveryPointService(
                points,
                associations,
                processedEvents,
                new OrderProperties(),
                Clock.fixed(now, ZoneOffset.UTC)
        );
    }

    @Test
    void catalogueAndMyLocationsSupportEmptyAndPagedReads() {
        DeliveryPointEntity seed = seed(1L, "com1");
        when(points.findByCodeIsNotNullAndActiveTrueOrderByIdAsc(PageRequest.of(0, 20)))
                .thenReturn(new PageImpl<>(List.of(seed)));
        PageResponse<DeliveryPointResponse> catalogue = service.catalogue(0, 20);
        assertEquals(1, catalogue.content().size());
        assertEquals("com1", catalogue.content().getFirst().code());
        assertNull(catalogue.content().getFirst().useCount());
        assertTrue(service.catalogue(0, 0).content().isEmpty());
        assertThrows(ApiException.class, () -> service.catalogue(-1, 20));
        assertThrows(ApiException.class, () -> service.catalogue(0, 101));

        UserDeliveryPointEntity usage = association(1L, 4);
        usage.setNickname("Studio");
        when(associations.findByUserIdOrderByUseCountDescLastUsedAtDesc(user.userId(), PageRequest.of(0, 20)))
                .thenReturn(new PageImpl<>(List.of(usage)));
        when(points.findActiveByIdIn(List.of(1L))).thenReturn(List.of(seed));
        PageResponse<DeliveryPointResponse> mine = service.myLocations(user, 0, 20);
        assertEquals(1, mine.content().size());
        assertEquals(4, mine.content().getFirst().useCount());
        assertEquals("Studio", mine.content().getFirst().nickname());
        assertEquals(now, mine.content().getFirst().lastUsedAt());
        assertTrue(service.myLocations(user, 0, 0).content().isEmpty());
    }

    @Test
    void myLocationsSkipsInactiveOrMissingPoints() {
        when(associations.findByUserIdOrderByUseCountDescLastUsedAtDesc(user.userId(), PageRequest.of(0, 20)))
                .thenReturn(new PageImpl<>(List.of(association(7L, 1))));
        when(points.findActiveByIdIn(List.of(7L))).thenReturn(List.of());
        assertTrue(service.myLocations(user, 0, 20).content().isEmpty());
    }

    @Test
    void prepareRejectsOutOfBoundsInlineDropoff() {
        CreateOrderRequest request = new CreateOrderRequest(
                "Print", 1, now.plusSeconds(60), now.plusSeconds(120), "2",
                null, "Spot", "Bld", "Desc", 1.2, 103.78);

        assertThrows(ApiException.class, () -> service.prepareForCreate(user, request));
    }

    @Test
    void prepareRequiresInlineFieldsAndCoords() {
        CreateOrderRequest missingName = new CreateOrderRequest(
                "Print", 1, now.plusSeconds(60), now.plusSeconds(120), "2",
                null, " ", "Bld", "Desc", 1.295, 103.77);
        assertThrows(ApiException.class, () -> service.prepareForCreate(user, missingName));

        CreateOrderRequest missingCoords = new CreateOrderRequest(
                "Print", 1, now.plusSeconds(60), now.plusSeconds(120), "2",
                null, "Spot", "Bld", "Desc", null, 103.77);
        assertThrows(ApiException.class, () -> service.prepareForCreate(user, missingCoords));
    }

    @Test
    void prepareInlineInBoundsSucceeds() {
        PreparedDropoff prepared = service.prepareForCreate(user, new CreateOrderRequest(
                "Print", 1, now.plusSeconds(60), now.plusSeconds(120), "2",
                null, "  Spot  ", "Bld", "Desc", 1.295, 103.77));
        assertNull(prepared.existingId());
        assertEquals("Spot", prepared.name());
        assertFalse(prepared.isExisting());
    }

    @Test
    void prepareAllowsSeedIdWithoutGeofenceRecheck() {
        DeliveryPointEntity seed = seed(1L, "com1");
        when(points.findById(1L)).thenReturn(Optional.of(seed));

        PreparedDropoff prepared = service.prepareForCreate(user, new CreateOrderRequest(
                "Print", 1, now.plusSeconds(60), now.plusSeconds(120), "2",
                1L, null, null, null, null, null));

        assertEquals(1L, prepared.existingId());
        assertEquals("COM1", prepared.name());
        assertTrue(prepared.isExisting());
    }

    @Test
    void prepareAllowsOwnForkAndRejectsInactiveOrUnknown() {
        DeliveryPointEntity fork = seed(9L, null);
        when(points.findById(9L)).thenReturn(Optional.of(fork));
        when(associations.existsByUserIdAndDeliveryPointId(user.userId(), 9L)).thenReturn(true);
        assertEquals(9L, service.prepareForCreate(user, new CreateOrderRequest(
                "Print", 1, now.plusSeconds(60), now.plusSeconds(120), "2",
                9L, null, null, null, null, null)).existingId());

        DeliveryPointEntity inactive = seed(8L, "x");
        inactive.setActive(false);
        when(points.findById(8L)).thenReturn(Optional.of(inactive));
        CreateOrderRequest inactiveRequest = new CreateOrderRequest(
                "Print", 1, now.plusSeconds(60), now.plusSeconds(120), "2",
                8L, null, null, null, null, null);
        assertThrows(ApiException.class, () -> service.prepareForCreate(user, inactiveRequest));

        when(points.findById(404L)).thenReturn(Optional.empty());
        CreateOrderRequest missing = new CreateOrderRequest(
                "Print", 1, now.plusSeconds(60), now.plusSeconds(120), "2",
                404L, null, null, null, null, null);
        assertThrows(ApiException.class, () -> service.prepareForCreate(user, missing));
    }

    @Test
    void prepareRejectsForeignFork() {
        DeliveryPointEntity fork = seed(9L, null);
        when(points.findById(9L)).thenReturn(Optional.of(fork));
        when(associations.existsByUserIdAndDeliveryPointId(user.userId(), 9L)).thenReturn(false);
        CreateOrderRequest request = new CreateOrderRequest(
                "Print", 1, now.plusSeconds(60), now.plusSeconds(120), "2",
                9L, null, null, null, null, null);

        assertThrows(ApiException.class, () -> service.prepareForCreate(user, request));
    }

    @Test
    void persistPreparedHandlesExistingAndInline() {
        ResolvedDropoff existing = service.persistPrepared(new PreparedDropoff(
                5L, "COM1", "Bld", "Lobby", 1.295, 103.77));
        assertEquals(5L, existing.id());

        when(points.save(any())).thenAnswer(invocation -> {
            DeliveryPointEntity point = invocation.getArgument(0);
            point.setId(42L);
            return point;
        });
        ResolvedDropoff created = service.persistPrepared(new PreparedDropoff(
                null, "Custom", "Bld", "Near stairs", 1.295, 103.77));
        assertEquals(42L, created.id());
        assertEquals("Custom", created.name());
    }

    @Test
    void recordSuccessfulUseUpsertsAssociation() {
        service.recordSuccessfulUse(user.userId(), 3L);
        verify(associations).upsertUsage(user.userId(), 3L, now);
    }

    @Test
    void seedEditAlwaysForksEvenForSoleUser() {
        DeliveryPointEntity seed = seed(1L, "com1");
        UserDeliveryPointEntity association = association(1L, 3);
        association.setNickname("Desk");
        when(associations.existsByUserIdAndDeliveryPointId(user.userId(), 1L)).thenReturn(true);
        when(points.lockById(1L)).thenReturn(Optional.of(seed));
        when(associations.countByDeliveryPointId(1L)).thenReturn(1L);
        when(associations.findByUserIdAndDeliveryPointId(user.userId(), 1L)).thenReturn(Optional.of(association));
        when(points.save(any())).thenAnswer(invocation -> {
            DeliveryPointEntity fork = invocation.getArgument(0);
            fork.setId(99L);
            return fork;
        });

        DeliveryPointResponse response = service.update(user, 1L, new UpdateDeliveryPointRequest(
                "My COM1", null, null, null, null, null));

        assertEquals(99L, response.id());
        assertEquals("My COM1", response.name());
        assertEquals("Desk", response.nickname());
        assertNull(response.code());
        verify(associations).delete(association);
        ArgumentCaptor<UserDeliveryPointEntity> moved = ArgumentCaptor.forClass(UserDeliveryPointEntity.class);
        verify(associations).save(moved.capture());
        assertEquals(99L, moved.getValue().getDeliveryPointId());
        assertEquals(3, moved.getValue().getUseCount());
        assertEquals("Desk", moved.getValue().getNickname());
    }

    @Test
    void sharedForkEditAlsoCopyOnWrites() {
        DeliveryPointEntity fork = seed(20L, null);
        UserDeliveryPointEntity association = association(20L, 2);
        when(associations.existsByUserIdAndDeliveryPointId(user.userId(), 20L)).thenReturn(true);
        when(points.lockById(20L)).thenReturn(Optional.of(fork));
        when(associations.countByDeliveryPointId(20L)).thenReturn(2L);
        when(associations.findByUserIdAndDeliveryPointId(user.userId(), 20L)).thenReturn(Optional.of(association));
        when(points.save(any())).thenAnswer(invocation -> {
            DeliveryPointEntity created = invocation.getArgument(0);
            created.setId(21L);
            return created;
        });

        association.setNickname("Home");
        DeliveryPointResponse response = service.update(user, 20L, new UpdateDeliveryPointRequest(
                null, "Tower", " ", null, null, null));
        assertEquals(21L, response.id());
        assertEquals("Tower", response.building());
        assertEquals("Lobby", response.description());
        assertEquals("Home", response.nickname());
    }

    @Test
    void soleUserForkUpdatesInPlace() {
        DeliveryPointEntity fork = seed(20L, null);
        UserDeliveryPointEntity association = association(20L, 2);
        when(associations.existsByUserIdAndDeliveryPointId(user.userId(), 20L)).thenReturn(true);
        when(points.lockById(20L)).thenReturn(Optional.of(fork));
        when(associations.countByDeliveryPointId(20L)).thenReturn(1L);
        when(associations.findByUserIdAndDeliveryPointId(user.userId(), 20L)).thenReturn(Optional.of(association));

        DeliveryPointResponse response = service.update(user, 20L, new UpdateDeliveryPointRequest(
                "Renamed", null, null, 1.295, 103.77, null));

        assertEquals(20L, response.id());
        assertEquals("Renamed", response.name());
        assertEquals(1.295, fork.getLatitude());
    }

    @Test
    void nicknameOnlyPatchDoesNotCow() {
        DeliveryPointEntity seed = seed(1L, "com1");
        UserDeliveryPointEntity association = association(1L, 2);
        when(associations.existsByUserIdAndDeliveryPointId(user.userId(), 1L)).thenReturn(true);
        when(points.lockById(1L)).thenReturn(Optional.of(seed));
        when(associations.findByUserIdAndDeliveryPointId(user.userId(), 1L)).thenReturn(Optional.of(association));

        DeliveryPointResponse response = service.update(user, 1L, new UpdateDeliveryPointRequest(
                null, null, null, null, null, "  Tutorial  "));

        assertEquals(1L, response.id());
        assertEquals("Tutorial", response.nickname());
        assertEquals("Tutorial", association.getNickname());
        verify(points, never()).save(any());
    }

    @Test
    void updateRejectsMissingAssociationAndInactivePoint() {
        UpdateDeliveryPointRequest patch = new UpdateDeliveryPointRequest("x", null, null, null, null, null);
        when(associations.existsByUserIdAndDeliveryPointId(user.userId(), 20L)).thenReturn(false);
        assertThrows(ApiException.class, () -> service.update(user, 20L, patch));

        DeliveryPointEntity inactive = seed(20L, null);
        inactive.setActive(false);
        when(associations.existsByUserIdAndDeliveryPointId(user.userId(), 20L)).thenReturn(true);
        when(points.lockById(20L)).thenReturn(Optional.of(inactive));
        assertThrows(ApiException.class, () -> service.update(user, 20L, patch));
    }

    @Test
    void updateRejectsOutOfBoundsCoordinates() {
        DeliveryPointEntity fork = seed(21L, null);
        UpdateDeliveryPointRequest patch = new UpdateDeliveryPointRequest(null, null, null, 1.0, 103.77, null);
        when(associations.existsByUserIdAndDeliveryPointId(user.userId(), 21L)).thenReturn(true);
        when(points.lockById(21L)).thenReturn(Optional.of(fork));
        assertThrows(ApiException.class, () -> service.update(user, 21L, patch));
    }

    @Test
    void deleteInactivatesOrphanFork() {
        DeliveryPointEntity fork = seed(20L, null);
        when(associations.existsByUserIdAndDeliveryPointId(user.userId(), 20L)).thenReturn(true);
        when(points.lockById(20L)).thenReturn(Optional.of(fork));
        when(associations.findByUserIdAndDeliveryPointId(user.userId(), 20L))
                .thenReturn(Optional.of(association(20L, 1)));
        when(associations.countByDeliveryPointId(20L)).thenReturn(0L);

        service.delete(user, 20L);

        assertFalse(fork.isActive());
    }

    @Test
    void deleteDoesNotInactivateSeed() {
        DeliveryPointEntity seed = seed(1L, "com1");
        when(associations.existsByUserIdAndDeliveryPointId(user.userId(), 1L)).thenReturn(true);
        when(points.lockById(1L)).thenReturn(Optional.of(seed));
        when(associations.findByUserIdAndDeliveryPointId(user.userId(), 1L))
                .thenReturn(Optional.of(association(1L, 1)));

        service.delete(user, 1L);

        assertTrue(seed.isActive());
    }

    @Test
    void deleteRequiresAssociation() {
        when(associations.existsByUserIdAndDeliveryPointId(user.userId(), 3L)).thenReturn(false);
        assertThrows(ApiException.class, () -> service.delete(user, 3L));
    }

    @Test
    void userDeletedRemovesAssociationsAndInactivatesOrphanForks() {
        DeliveryPointEntity seed = seed(1L, "com1");
        DeliveryPointEntity fork = seed(20L, null);
        DeliveryPointEntity shared = seed(21L, null);
        UserDeliveryPointEntity seedUse = association(1L, 2);
        UserDeliveryPointEntity forkUse = association(20L, 1);
        UserDeliveryPointEntity sharedUse = association(21L, 1);
        when(processedEvents.existsById("del-1")).thenReturn(false);
        when(associations.findByUserId(user.userId())).thenReturn(List.of(seedUse, forkUse, sharedUse));
        when(points.lockById(1L)).thenReturn(Optional.of(seed));
        when(points.lockById(20L)).thenReturn(Optional.of(fork));
        when(points.lockById(21L)).thenReturn(Optional.of(shared));
        when(associations.countByDeliveryPointId(20L)).thenReturn(0L);
        when(associations.countByDeliveryPointId(21L)).thenReturn(1L);

        service.applyUserDeleted("del-1", user.userId());

        ArgumentCaptor<ProcessedEventEntity> processed = ArgumentCaptor.forClass(ProcessedEventEntity.class);
        verify(processedEvents).save(processed.capture());
        assertEquals("del-1", processed.getValue().getEventId());
        verify(associations).deleteAll(List.of(seedUse, forkUse, sharedUse));
        assertTrue(seed.isActive());
        assertFalse(fork.isActive());
        assertTrue(shared.isActive());
    }

    @Test
    void userDeletedIsIdempotentAndIgnoresBlankIds() {
        when(processedEvents.existsById("del-2")).thenReturn(true);
        service.applyUserDeleted("del-2", user.userId());
        verify(associations, never()).findByUserId(any());

        service.applyUserDeleted(" ", user.userId());
        service.applyUserDeleted("del-3", " ");
        verify(processedEvents, never()).save(any());
    }

    private static DeliveryPointEntity seed(long id, String code) {
        DeliveryPointEntity point = new DeliveryPointEntity();
        point.setId(id);
        point.setCode(code);
        point.setName(code == null ? "Fork" : "COM1");
        point.setBuilding("Building");
        point.setDescription("Lobby");
        point.setLatitude(1.295);
        point.setLongitude(103.77);
        point.setActive(true);
        return point;
    }

    private UserDeliveryPointEntity association(long pointId, int useCount) {
        UserDeliveryPointEntity row = new UserDeliveryPointEntity();
        row.setUserId(user.userId());
        row.setDeliveryPointId(pointId);
        row.setUseCount(useCount);
        row.setLastUsedAt(now);
        row.setCreatedAt(now);
        return row;
    }
}
