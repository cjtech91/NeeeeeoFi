CREATE TABLE IF NOT EXISTS licenses (
  license_key VARCHAR(64) PRIMARY KEY,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  owner VARCHAR(255) NULL,
  type VARCHAR(16) NOT NULL DEFAULT 'PAID',
  expires_at BIGINT NOT NULL DEFAULT 0,
  bound_serial VARCHAR(128) NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  INDEX (status),
  INDEX (bound_serial)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS machines (
  system_serial VARCHAR(128) PRIMARY KEY,
  device_model VARCHAR(255) NULL,
  last_seen_at BIGINT NULL,
  metadata_json TEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
