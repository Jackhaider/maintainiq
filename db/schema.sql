-- MaintainIQ database schema (MySQL 8.0+)
-- Eight tables in third normal form. Every non-key column depends only on its
-- table's primary key; lookups (roles, production lines) live in their own tables
-- and are referenced by foreign keys instead of being repeated as text.
--
-- WARNING: this script drops and recreates every MaintainIQ table.
-- Run it through `npm run db:setup`, which refuses to touch a production database.

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS maintenance_notes;
DROP TABLE IF EXISTS energy_readings;
DROP TABLE IF EXISTS downtime_logs;
DROP TABLE IF EXISTS work_orders;
DROP TABLE IF EXISTS machines;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS production_lines;
DROP TABLE IF EXISTS roles;
SET FOREIGN_KEY_CHECKS = 1;

-- 1. roles: the two access levels in the plant
CREATE TABLE roles (
  id          TINYINT UNSIGNED PRIMARY KEY,
  name        VARCHAR(30)  NOT NULL,
  description VARCHAR(255) NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_roles_name UNIQUE (name)
) ENGINE = InnoDB;

-- 2. production_lines: physical lines on the shop floor
CREATE TABLE production_lines (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code       VARCHAR(20)  NOT NULL,
  name       VARCHAR(100) NOT NULL,
  location   VARCHAR(100) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_production_lines_code UNIQUE (code)
) ENGINE = InnoDB;

-- 3. users: operators are assigned to one production line; supervisors see every line
CREATE TABLE users (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  role_id            TINYINT UNSIGNED NOT NULL,
  production_line_id INT UNSIGNED NULL,
  full_name          VARCHAR(100) NOT NULL,
  email              VARCHAR(255) NOT NULL,
  password_hash      CHAR(60)     NOT NULL,            -- bcrypt output is always 60 chars
  is_active          BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_users_email UNIQUE (email),
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles (id),
  CONSTRAINT fk_users_line FOREIGN KEY (production_line_id)
    REFERENCES production_lines (id) ON DELETE SET NULL,
  INDEX idx_users_role (role_id),
  INDEX idx_users_line (production_line_id)
) ENGINE = InnoDB;

-- 4. machines: every machine belongs to exactly one production line
CREATE TABLE machines (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  production_line_id INT UNSIGNED NOT NULL,
  asset_tag          VARCHAR(30)  NOT NULL,
  name               VARCHAR(100) NOT NULL,
  machine_type       VARCHAR(50)  NOT NULL,
  manufacturer       VARCHAR(100) NULL,
  rated_power_kw     DECIMAL(8,2) NOT NULL,
  status             ENUM('running','idle','maintenance','down') NOT NULL DEFAULT 'running',
  installed_on       DATE NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_machines_asset_tag UNIQUE (asset_tag),
  CONSTRAINT chk_machines_power CHECK (rated_power_kw > 0),
  CONSTRAINT fk_machines_line FOREIGN KEY (production_line_id)
    REFERENCES production_lines (id) ON DELETE RESTRICT,
  INDEX idx_machines_line_status (production_line_id, status)
) ENGINE = InnoDB;

-- 5. work_orders: maintenance requests raised by anyone, assigned and closed by supervisors
CREATE TABLE work_orders (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  machine_id   INT UNSIGNED NOT NULL,
  requested_by INT UNSIGNED NOT NULL,
  assigned_to  INT UNSIGNED NULL,
  title        VARCHAR(150) NOT NULL,
  description  TEXT NULL,
  order_type   ENUM('corrective','preventive','inspection') NOT NULL DEFAULT 'corrective',
  priority     ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  status       ENUM('open','assigned','in_progress','closed') NOT NULL DEFAULT 'open',
  due_date     DATE NULL,
  closed_at    DATETIME NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_work_orders_machine FOREIGN KEY (machine_id)
    REFERENCES machines (id) ON DELETE RESTRICT,
  CONSTRAINT fk_work_orders_requested_by FOREIGN KEY (requested_by) REFERENCES users (id),
  CONSTRAINT fk_work_orders_assigned_to FOREIGN KEY (assigned_to)
    REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_work_orders_closed CHECK (
    (status = 'closed' AND closed_at IS NOT NULL) OR (status <> 'closed' AND closed_at IS NULL)
  ),
  INDEX idx_work_orders_status_priority (status, priority),
  INDEX idx_work_orders_machine (machine_id),
  INDEX idx_work_orders_assigned (assigned_to, status)
) ENGINE = InnoDB;

-- 6. downtime_logs: periods when a machine was not producing
CREATE TABLE downtime_logs (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  machine_id      INT UNSIGNED NOT NULL,
  work_order_id   INT UNSIGNED NULL,
  reported_by     INT UNSIGNED NOT NULL,
  reason_category ENUM('mechanical','electrical','material','changeover','other') NOT NULL,
  description     VARCHAR(500) NULL,
  started_at      DATETIME NOT NULL,
  ended_at        DATETIME NULL,                    -- NULL while the machine is still down
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_downtime_period CHECK (ended_at IS NULL OR ended_at > started_at),
  CONSTRAINT fk_downtime_machine FOREIGN KEY (machine_id)
    REFERENCES machines (id) ON DELETE RESTRICT,
  CONSTRAINT fk_downtime_work_order FOREIGN KEY (work_order_id)
    REFERENCES work_orders (id) ON DELETE SET NULL,
  CONSTRAINT fk_downtime_reported_by FOREIGN KEY (reported_by) REFERENCES users (id),
  INDEX idx_downtime_machine_started (machine_id, started_at),
  INDEX idx_downtime_started (started_at)
) ENGINE = InnoDB;

-- 7. energy_readings: kWh consumed by a machine over one reading period
CREATE TABLE energy_readings (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  machine_id  INT UNSIGNED NOT NULL,
  recorded_by INT UNSIGNED NOT NULL,
  reading_date DATE NOT NULL,
  kwh         DECIMAL(10,2) NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_energy_machine_date UNIQUE (machine_id, reading_date),  -- one reading per machine per day
  CONSTRAINT chk_energy_kwh CHECK (kwh >= 0),
  CONSTRAINT fk_energy_machine FOREIGN KEY (machine_id)
    REFERENCES machines (id) ON DELETE RESTRICT,
  CONSTRAINT fk_energy_recorded_by FOREIGN KEY (recorded_by) REFERENCES users (id),
  INDEX idx_energy_date (reading_date)
) ENGINE = InnoDB;

-- 8. maintenance_notes: progress notes written against a work order
CREATE TABLE maintenance_notes (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  work_order_id INT UNSIGNED NOT NULL,
  author_id     INT UNSIGNED NOT NULL,
  note          TEXT NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_notes_work_order FOREIGN KEY (work_order_id)
    REFERENCES work_orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_notes_author FOREIGN KEY (author_id) REFERENCES users (id),
  INDEX idx_notes_work_order (work_order_id, created_at)
) ENGINE = InnoDB;
