-- 0001_immutability.sql
-- Immutability guards for contract columns.
-- Enforces invariants #4, #5, #6 from 02-data-model.md:
--   competitor_versions: model_provider, model_identifier, prompt_bundle_json,
--                        model_parameters_json, content_hash are frozen on creation.
--   case_versions:       content_hash, output_spec_json, runner_input_json are frozen.
--   responses:           body_text, content_hash are frozen.
-- Status/audit columns (responses.status, etc.) are allowed to change.
--
-- Use CREATE OR REPLACE + DROP TRIGGER IF EXISTS for idempotency.

CREATE OR REPLACE FUNCTION guard_immutable_contract_columns()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'competitor_versions' THEN
    IF NEW.model_provider        IS DISTINCT FROM OLD.model_provider
    OR NEW.model_identifier      IS DISTINCT FROM OLD.model_identifier
    OR NEW.prompt_bundle_json    IS DISTINCT FROM OLD.prompt_bundle_json
    OR NEW.model_parameters_json IS DISTINCT FROM OLD.model_parameters_json
    OR NEW.content_hash          IS DISTINCT FROM OLD.content_hash
    THEN
      RAISE EXCEPTION
        'competitor_versions contract columns are immutable (row id=%)', OLD.id;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'case_versions' THEN
    IF NEW.content_hash      IS DISTINCT FROM OLD.content_hash
    OR NEW.output_spec_json  IS DISTINCT FROM OLD.output_spec_json
    OR NEW.runner_input_json IS DISTINCT FROM OLD.runner_input_json
    THEN
      RAISE EXCEPTION
        'case_versions contract columns are immutable (row id=%)', OLD.id;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'responses' THEN
    IF NEW.body_text    IS DISTINCT FROM OLD.body_text
    OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
    THEN
      RAISE EXCEPTION
        'responses contract columns are immutable (row id=%)', OLD.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- competitor_versions
DROP TRIGGER IF EXISTS trg_immutable_competitor_versions ON competitor_versions;
CREATE TRIGGER trg_immutable_competitor_versions
  BEFORE UPDATE ON competitor_versions
  FOR EACH ROW EXECUTE FUNCTION guard_immutable_contract_columns();

-- case_versions
DROP TRIGGER IF EXISTS trg_immutable_case_versions ON case_versions;
CREATE TRIGGER trg_immutable_case_versions
  BEFORE UPDATE ON case_versions
  FOR EACH ROW EXECUTE FUNCTION guard_immutable_contract_columns();

-- responses
DROP TRIGGER IF EXISTS trg_immutable_responses ON responses;
CREATE TRIGGER trg_immutable_responses
  BEFORE UPDATE ON responses
  FOR EACH ROW EXECUTE FUNCTION guard_immutable_contract_columns();
