CREATE TABLE order_log (
    id UUID PRIMARY KEY,
    order_id UUID NOT NULL,
    action VARCHAR(64) NOT NULL,
    from_status VARCHAR(32),
    to_status VARCHAR(32) NOT NULL,
    actor_id VARCHAR(64),
    occurred_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX order_log_order_occurred_idx ON order_log (order_id, occurred_at);

CREATE FUNCTION order_log_forbid_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'order_log is append-only';
END;
$$;

CREATE TRIGGER order_log_no_update
    BEFORE UPDATE ON order_log
    FOR EACH ROW
    EXECUTE FUNCTION order_log_forbid_change();

CREATE TRIGGER order_log_no_delete
    BEFORE DELETE ON order_log
    FOR EACH ROW
    EXECUTE FUNCTION order_log_forbid_change();
