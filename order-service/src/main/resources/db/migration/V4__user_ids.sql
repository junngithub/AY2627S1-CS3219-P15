ALTER TABLE orders RENAME COLUMN requester_email TO requester_id;
ALTER TABLE orders RENAME COLUMN courier_email TO courier_id;
ALTER INDEX orders_requester_request_time_idx RENAME TO orders_requester_id_request_time_idx;

ALTER TABLE alerts RENAME COLUMN requester_email TO requester_id;
ALTER INDEX alerts_requester_created_idx RENAME TO alerts_requester_id_created_idx;
