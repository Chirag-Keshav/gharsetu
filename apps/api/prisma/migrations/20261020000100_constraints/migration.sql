-- Hand-written constraints that Prisma cannot express (SPEC §5, §11, §11.1).

-- Extensions --------------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Human-readable references from sequences (never contain the brand) -------------------------------
CREATE SEQUENCE ref_seq_req;
CREATE SEQUENCE ref_seq_quo;
CREATE SEQUENCE ref_seq_wo;
CREATE SEQUENCE ref_seq_iss;
CREATE SEQUENCE ref_seq_lst;
CREATE SEQUENCE ref_seq_bkg;
CREATE SEQUENCE ref_seq_pyt;
CREATE SEQUENCE ref_seq_inv;

CREATE FUNCTION next_reference(prefix text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  n bigint;
BEGIN
  n := nextval('ref_seq_' || lower(prefix));
  RETURN upper(prefix) || '-' || lpad(n::text, 6, '0');
END;
$$;

-- Availability integrity: double-booking impossible at database level (§7 rule 15) ---------------
ALTER TABLE listing_occupancy
  ADD CONSTRAINT listing_occupancy_dates_chk CHECK (end_date > start_date),
  ADD CONSTRAINT listing_occupancy_no_overlap
    EXCLUDE USING gist (listing_id WITH =, daterange(start_date, end_date, '[)') WITH &&);

ALTER TABLE listing_price_rules
  ADD CONSTRAINT listing_price_rules_dates_chk CHECK (end_date >= start_date),
  ADD CONSTRAINT listing_price_rules_amount_chk CHECK (nightly_price_paise >= 0),
  ADD CONSTRAINT listing_price_rules_no_overlap
    EXCLUDE USING gist (listing_id WITH =, daterange(start_date, end_date, '[]') WITH &&);

-- Money and range checks ---------------------------------------------------------------------------
ALTER TABLE listings
  ADD CONSTRAINT listings_money_chk CHECK (
    base_price_paise >= 0 AND cleaning_fee_paise >= 0 AND (weekend_price_paise IS NULL OR weekend_price_paise >= 0)),
  ADD CONSTRAINT listings_capacity_chk CHECK (max_guests >= 1 AND bedrooms >= 0 AND beds >= 0 AND bathrooms >= 0),
  ADD CONSTRAINT listings_nights_chk CHECK (min_nights >= 1 AND max_nights >= min_nights);

ALTER TABLE bookings
  ADD CONSTRAINT bookings_dates_chk CHECK (check_out_date > check_in_date),
  ADD CONSTRAINT bookings_money_chk CHECK (
    nights_total_paise >= 0 AND cleaning_fee_paise >= 0 AND tax_paise >= 0 AND total_paise >= 0
    AND commission_paise >= 0 AND owner_payout_paise >= 0 AND refund_paise >= 0 AND refund_paise <= total_paise),
  ADD CONSTRAINT bookings_commission_bps_chk CHECK (commission_bps_applied BETWEEN 0 AND 10000),
  ADD CONSTRAINT bookings_guests_chk CHECK (guests_count >= 1);

ALTER TABLE payouts ADD CONSTRAINT payouts_money_chk CHECK (amount_paise >= 0 AND adjustment_paise >= 0);
ALTER TABLE inspections ADD CONSTRAINT inspections_money_chk CHECK (fee_paise >= 0);
ALTER TABLE quotes ADD CONSTRAINT quotes_money_chk CHECK (
  subtotal_paise >= 0 AND tax_paise >= 0 AND total_paise >= 0 AND (approved_total_paise IS NULL OR approved_total_paise >= 0));
ALTER TABLE quote_line_items ADD CONSTRAINT quote_line_items_money_chk CHECK (
  quantity >= 0 AND unit_price_paise >= 0 AND line_total_paise >= 0 AND line_tax_paise >= 0
  AND tax_rate_bps BETWEEN 0 AND 10000 AND (internal_cost_paise IS NULL OR internal_cost_paise >= 0));
ALTER TABLE work_orders
  ADD CONSTRAINT work_orders_money_chk CHECK (approved_total_paise >= 0),
  ADD CONSTRAINT work_orders_quote_chk CHECK (kind = 'REWORK' OR quote_id IS NOT NULL),
  ADD CONSTRAINT work_orders_rework_chk CHECK (kind <> 'REWORK' OR issue_id IS NOT NULL);
ALTER TABLE payment_requirements ADD CONSTRAINT payment_requirements_money_chk CHECK (amount_paise >= 0);
ALTER TABLE payments
  ADD CONSTRAINT payments_money_chk CHECK (amount_paise >= 0 AND refunded_paise >= 0 AND refunded_paise <= amount_paise),
  ADD CONSTRAINT payments_subject_chk CHECK ((requirement_id IS NULL) <> (booking_id IS NULL));
ALTER TABLE refunds ADD CONSTRAINT refunds_money_chk CHECK (amount_paise > 0);
ALTER TABLE invoices ADD CONSTRAINT invoices_money_chk CHECK (amount_paise >= 0);
ALTER TABLE commission_benchmarks ADD CONSTRAINT commission_benchmarks_bps_chk CHECK (commission_bps BETWEEN 0 AND 10000);
ALTER TABLE owner_profiles ADD CONSTRAINT owner_profiles_override_chk CHECK (
  commission_override_bps IS NULL OR commission_override_bps BETWEEN 0 AND 10000);
ALTER TABLE reviews ADD CONSTRAINT reviews_rating_chk CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE service_providers ADD CONSTRAINT service_providers_rating_chk CHECK (
  internal_rating IS NULL OR internal_rating BETWEEN 1 AND 5);

CREATE UNIQUE INDEX work_assignments_active_uniq ON work_assignments (work_order_id, provider_id) WHERE status = 'ACTIVE';

-- Append-only tables (§8.12): audit_events, status_events and messages ----------------------------
CREATE FUNCTION reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER status_events_append_only BEFORE UPDATE OR DELETE ON status_events
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER messages_append_only BEFORE UPDATE OR DELETE ON messages
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- Quote immutability once not DRAFT (§6.4) ---------------------------------------------------------
CREATE FUNCTION quotes_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'quote % is frozen', OLD.id USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'DRAFT' AND (
       NEW.subtotal_paise IS DISTINCT FROM OLD.subtotal_paise
    OR NEW.tax_paise IS DISTINCT FROM OLD.tax_paise
    OR NEW.total_paise IS DISTINCT FROM OLD.total_paise
    OR NEW.scope IS DISTINCT FROM OLD.scope
    OR NEW.exclusions IS DISTINCT FROM OLD.exclusions
    OR NEW.assumptions IS DISTINCT FROM OLD.assumptions
    OR NEW.estimated_duration IS DISTINCT FROM OLD.estimated_duration
    OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.quote_type IS DISTINCT FROM OLD.quote_type
    OR NEW.request_id IS DISTINCT FROM OLD.request_id
    OR NEW.work_order_id IS DISTINCT FROM OLD.work_order_id
    OR NEW.base_quote_id IS DISTINCT FROM OLD.base_quote_id
    OR NEW.currency IS DISTINCT FROM OLD.currency
  ) THEN
    RAISE EXCEPTION 'quote % is frozen', OLD.id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER quotes_immutable_trg BEFORE UPDATE OR DELETE ON quotes
  FOR EACH ROW EXECUTE FUNCTION quotes_immutable();

CREATE FUNCTION quote_lines_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status text;
BEGIN
  SELECT status::text INTO parent_status FROM quotes
    WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.quote_id ELSE NEW.quote_id END;
  IF parent_status IS NOT NULL AND parent_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'line items of a frozen quote cannot change' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.quote_id IS DISTINCT FROM OLD.quote_id THEN
    RAISE EXCEPTION 'line items cannot move between quotes' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER quote_lines_immutable_trg BEFORE INSERT OR UPDATE OR DELETE ON quote_line_items
  FOR EACH ROW EXECUTE FUNCTION quote_lines_immutable();

-- Booking pricing and commission immutability (§11) ---------------------------------------------
CREATE FUNCTION bookings_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.pricing_snapshot IS DISTINCT FROM OLD.pricing_snapshot
    OR NEW.nights_total_paise IS DISTINCT FROM OLD.nights_total_paise
    OR NEW.cleaning_fee_paise IS DISTINCT FROM OLD.cleaning_fee_paise
    OR NEW.tax_paise IS DISTINCT FROM OLD.tax_paise
    OR NEW.total_paise IS DISTINCT FROM OLD.total_paise
    OR NEW.commission_bps_applied IS DISTINCT FROM OLD.commission_bps_applied
    OR NEW.commission_benchmark_snapshot IS DISTINCT FROM OLD.commission_benchmark_snapshot
    OR NEW.cancellation_policy_snapshot IS DISTINCT FROM OLD.cancellation_policy_snapshot
    OR NEW.booking_mode_snapshot IS DISTINCT FROM OLD.booking_mode_snapshot
    OR NEW.check_in_date IS DISTINCT FROM OLD.check_in_date
    OR NEW.check_out_date IS DISTINCT FROM OLD.check_out_date
    OR NEW.nights IS DISTINCT FROM OLD.nights
    OR NEW.listing_id IS DISTINCT FROM OLD.listing_id
    OR NEW.customer_user_id IS DISTINCT FROM OLD.customer_user_id
    OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
  THEN
    RAISE EXCEPTION 'booking % pricing is immutable', OLD.id USING ERRCODE = 'P0001';
  END IF;
  -- Cancellation is the only event that may adjust commission and payout amounts.
  IF (NEW.commission_paise IS DISTINCT FROM OLD.commission_paise
      OR NEW.owner_payout_paise IS DISTINCT FROM OLD.owner_payout_paise)
     AND NEW.status <> 'CANCELLED' THEN
    RAISE EXCEPTION 'booking % commission is immutable', OLD.id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER bookings_immutable_trg BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION bookings_immutable();

-- ADMIN role exclusivity (§2.1) ---------------------------------------------------------------------
CREATE FUNCTION user_roles_admin_exclusive() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role = 'ADMIN' AND EXISTS (
       SELECT 1 FROM user_roles WHERE user_id = NEW.user_id AND role <> 'ADMIN') THEN
    RAISE EXCEPTION 'ADMIN cannot coexist with other roles' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.role <> 'ADMIN' AND EXISTS (
       SELECT 1 FROM user_roles WHERE user_id = NEW.user_id AND role = 'ADMIN') THEN
    RAISE EXCEPTION 'ADMIN cannot coexist with other roles' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER user_roles_admin_exclusive_trg BEFORE INSERT OR UPDATE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION user_roles_admin_exclusive();

-- Search (§8.4): full-text vector maintained by trigger, trigram index for suggestions -------------
CREATE FUNCTION listings_search_vector() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  loc text;
BEGIN
  SELECT concat_ws(' ', city, district, state) INTO loc FROM properties WHERE id = NEW.property_id;
  NEW.search_vector :=
       setweight(to_tsvector('simple', coalesce(NEW.public_area_label, '') || ' ' || coalesce(loc, '')), 'A')
    || setweight(to_tsvector('english', coalesce(NEW.title, '')), 'B')
    || setweight(to_tsvector('english', coalesce(NEW.description, '')), 'C');
  RETURN NEW;
END;
$$;
CREATE TRIGGER listings_search_vector_trg BEFORE INSERT OR UPDATE OF title, description, public_area_label, property_id
  ON listings FOR EACH ROW EXECUTE FUNCTION listings_search_vector();

CREATE INDEX listings_search_idx ON listings USING gin (search_vector);
CREATE INDEX listings_area_trgm_idx ON listings USING gin (public_area_label gin_trgm_ops);
CREATE INDEX properties_city_trgm_idx ON properties USING gin (city gin_trgm_ops);
CREATE INDEX service_areas_pins_idx ON service_areas USING gin (pin_codes);
