CREATE TABLE IF NOT EXISTS licenses (
  license_key TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active', -- active|revoked
  owner TEXT,
  type TEXT NOT NULL DEFAULT 'PAID',     -- PAID|TRIAL|RESTRICTED
  expires_at INTEGER,                    -- unix ms; NULL/0 = never
  bound_serial TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE IF NOT EXISTS machines (
  system_serial TEXT PRIMARY KEY,
  device_model TEXT,
  last_seen_at INTEGER,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS sub_vendo_licenses (
  license_key TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'unused',
  hardware_id TEXT,
  activated_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
