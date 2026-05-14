CREATE TABLE IF NOT EXISTS description_category_map (
  id                     SERIAL PRIMARY KEY,
  created_by             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  normalized_description TEXT NOT NULL,
  original_description   TEXT,
  category               VARCHAR(100) NOT NULL,
  updated_at             TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (created_by, normalized_description)
);

CREATE INDEX IF NOT EXISTS idx_dcm_user_desc ON description_category_map (created_by, normalized_description);