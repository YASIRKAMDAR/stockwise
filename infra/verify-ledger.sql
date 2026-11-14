-- Recomputes every stock balance from immutable ledger lines and fails if any projection differs.
\pset footer off
WITH led AS (
  SELECT loc, product_id, sum(q)::bigint q FROM (
    SELECT to_location_id loc, product_id, quantity q FROM inventory_event_lines WHERE to_location_id IS NOT NULL
    UNION ALL SELECT from_location_id, product_id, -quantity FROM inventory_event_lines WHERE from_location_id IS NOT NULL) x
  GROUP BY loc, product_id),
diff AS (
  SELECT COALESCE(b.location_id, led.loc) loc, COALESCE(b.product_id, led.product_id) product_id, COALESCE(b.quantity,0) projected, COALESCE(led.q,0) ledger
    FROM stock_balances b FULL JOIN led ON led.loc = b.location_id AND led.product_id = b.product_id
   WHERE COALESCE(b.quantity,0) <> COALESCE(led.q,0))
SELECT (SELECT count(*) FROM inventory_events) AS events, (SELECT count(*) FROM inventory_event_lines) AS lines,
       (SELECT count(*) FROM stock_balances) AS balances, (SELECT count(*) FROM diff) AS mismatches;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM stock_balances WHERE quantity < 0) THEN RAISE EXCEPTION 'negative balance found'; END IF;
  IF (WITH led AS (SELECT loc, product_id, sum(q) q FROM (SELECT to_location_id loc, product_id, quantity q FROM inventory_event_lines WHERE to_location_id IS NOT NULL
        UNION ALL SELECT from_location_id, product_id, -quantity FROM inventory_event_lines WHERE from_location_id IS NOT NULL) x GROUP BY 1,2)
      SELECT count(*) FROM stock_balances b FULL JOIN led ON led.loc=b.location_id AND led.product_id=b.product_id WHERE COALESCE(b.quantity,0) <> COALESCE(led.q,0)) > 0
  THEN RAISE EXCEPTION 'LEDGER MISMATCH: balances differ from event ledger'; END IF;
  RAISE NOTICE 'ledger verification PASSED';
END $$;
