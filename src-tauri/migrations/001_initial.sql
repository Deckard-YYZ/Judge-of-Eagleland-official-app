-- The game state stays in one JSON document; these tables are the storage edge.
CREATE TABLE IF NOT EXISTS profiles (
  profile_id TEXT PRIMARY KEY,
  login_name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS saves (
  save_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  save_schema_version INTEGER NOT NULL,
  content_package_id TEXT NOT NULL,
  content_version TEXT NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_saves_profile ON saves(profile_id);

CREATE TABLE IF NOT EXISTS settings (
  scope TEXT NOT NULL,
  setting_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  PRIMARY KEY (scope, setting_key)
);

-- A single marker table lets the bootstrap screen prove a real plugin round trip.
CREATE TABLE IF NOT EXISTS runtime_probe (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
