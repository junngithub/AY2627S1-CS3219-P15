CREATE TABLE orders (
    id UUID PRIMARY KEY,
    requester_email VARCHAR(320) NOT NULL,
    requester_telegram_handle VARCHAR(64),
    courier_email VARCHAR(320),
    courier_rating DOUBLE PRECISION,
    requester_rating DOUBLE PRECISION,
    item_description VARCHAR(500) NOT NULL,
    amount INTEGER NOT NULL CHECK (amount >= 1),
    status VARCHAR(32) NOT NULL,
    request_time TIMESTAMPTZ NOT NULL,
    acceptance_expiry TIMESTAMPTZ NOT NULL,
    delivery_deadline TIMESTAMPTZ NOT NULL,
    collection_deadline TIMESTAMPTZ,
    acknowledgement_deadline TIMESTAMPTZ,
    settled_at TIMESTAMPTZ,
    pickup_location_id VARCHAR(64) NOT NULL,
    pickup_name VARCHAR(200) NOT NULL,
    pickup_lat DOUBLE PRECISION NOT NULL,
    pickup_lng DOUBLE PRECISION NOT NULL,
    dropoff_location_id VARCHAR(64) NOT NULL,
    dropoff_name VARCHAR(200) NOT NULL,
    dropoff_lat DOUBLE PRECISION NOT NULL,
    dropoff_lng DOUBLE PRECISION NOT NULL,
    collection_photo_ref VARCHAR(500),
    delivery_photo_ref VARCHAR(500),
    dispute_text VARCHAR(2000),
    case_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX orders_status_idx ON orders (status);
CREATE INDEX orders_pickup_lat_lng_idx ON orders (pickup_lat, pickup_lng);
CREATE INDEX orders_requester_request_time_idx ON orders (requester_email, request_time DESC);

CREATE TABLE outbox (
    id UUID PRIMARY KEY,
    order_id UUID NOT NULL,
    topic VARCHAR(120) NOT NULL,
    message_key VARCHAR(64) NOT NULL,
    payload TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    published_at TIMESTAMPTZ
);

CREATE INDEX outbox_unpublished_idx ON outbox (created_at) WHERE published_at IS NULL;

CREATE TABLE alerts (
    id UUID PRIMARY KEY,
    order_id UUID NOT NULL,
    requester_email VARCHAR(320) NOT NULL,
    from_status VARCHAR(32),
    to_status VARCHAR(32) NOT NULL,
    notify_requester BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX alerts_requester_created_idx ON alerts (requester_email, created_at DESC);

CREATE TABLE processed_events (
    event_id VARCHAR(64) PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL
);
