use anyhow::{bail, Result};
use rusqlite::Connection;
use std::path::Path;

use crate::kdf::key_pragma;

pub const LATEST_VERSION: i64 = 6;

pub fn open_with_key(path: &Path, key: &[u8; 32], salt: &[u8; 16]) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(&key_pragma(key, salt))?;
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    Ok(conn)
}

pub fn migrate(conn: &Connection) -> Result<()> {
    let _ = conn.execute("ALTER TABLE balance_lines ADD COLUMN is_tax INTEGER NOT NULL DEFAULT 0", []);
    let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if v > LATEST_VERSION {
        bail!("База создана более новой версией приложения");
    }
    if v < 1 {
        let sql = format!("BEGIN;\n{SCHEMA_V1}\nPRAGMA user_version = 1;\nCOMMIT;");
        if let Err(e) = conn.execute_batch(&sql) { let _ = conn.execute_batch("ROLLBACK;"); return Err(e.into()); }
    }
    if v < 2 {
        let sql = format!("BEGIN;\n{SCHEMA_V2}\nPRAGMA user_version = 2;\nCOMMIT;");
        if let Err(e) = conn.execute_batch(&sql) { let _ = conn.execute_batch("ROLLBACK;"); return Err(e.into()); }
    }
    if v < 3 {
        let sql = format!("BEGIN;\n{SCHEMA_V3}\nPRAGMA user_version = 3;\nCOMMIT;");
        if let Err(e) = conn.execute_batch(&sql) { let _ = conn.execute_batch("ROLLBACK;"); return Err(e.into()); }
    }
    if v < 4 {
        let sql = format!("BEGIN;\n{SCHEMA_V4}\nPRAGMA user_version = 4;\nCOMMIT;");
        if let Err(e) = conn.execute_batch(&sql) { let _ = conn.execute_batch("ROLLBACK;"); return Err(e.into()); }
    }
    if v < 5 {
        let sql = format!("BEGIN;\n{SCHEMA_V5}\nPRAGMA user_version = 5;\nCOMMIT;");
        if let Err(e) = conn.execute_batch(&sql) { let _ = conn.execute_batch("ROLLBACK;"); return Err(e.into()); }
    }
    if v < 6 {
        let sql = format!("BEGIN;\n{SCHEMA_V6}\nPRAGMA user_version = 6;\nCOMMIT;");
        if let Err(e) = conn.execute_batch(&sql) { let _ = conn.execute_batch("ROLLBACK;"); return Err(e.into()); }
    }
    Ok(())
}

const SCHEMA_V1: &str = r#"
CREATE TABLE balance_snapshots (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    date         TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    currency     TEXT NOT NULL CHECK (currency IN ('KZT','USD','EUR','RUB')),
    amount_minor INTEGER NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX uq_snapshot_date_currency ON balance_snapshots(date, currency);
CREATE INDEX idx_snapshot_date ON balance_snapshots(date);

CREATE TABLE categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL CHECK (type IN ('income','expense')),
    is_interest INTEGER NOT NULL DEFAULT 0 CHECK (is_interest IN (0,1))
);

CREATE TABLE operations (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    date         TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    type         TEXT NOT NULL CHECK (type IN ('income','expense')),
    currency     TEXT NOT NULL CHECK (currency IN ('KZT','USD','EUR','RUB')),
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    category_id  INTEGER REFERENCES categories(id) ON DELETE RESTRICT,
    comment      TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_op_date ON operations(date);

CREATE TABLE exchange_rates (
    resolved_for_date TEXT NOT NULL,
    currency          TEXT NOT NULL CHECK (currency IN ('KZT','USD','EUR','RUB')),
    source_date       TEXT NOT NULL,
    rate_scaled       INTEGER NOT NULL CHECK (rate_scaled > 0),
    quant             INTEGER NOT NULL DEFAULT 1 CHECK (quant > 0),
    source            TEXT NOT NULL CHECK (source IN ('nbrk','nbrk_prev')),
    needs_recheck     INTEGER NOT NULL DEFAULT 0 CHECK (needs_recheck IN (0,1)),
    PRIMARY KEY (resolved_for_date, currency)
);

CREATE TABLE debts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    kind            TEXT NOT NULL CHECK (kind IN ('deposit','loan')),
    name            TEXT NOT NULL,
    currency        TEXT NOT NULL CHECK (currency IN ('KZT','USD','EUR','RUB')),
    principal_minor INTEGER NOT NULL CHECK (principal_minor > 0),
    rate_bp         INTEGER NOT NULL CHECK (rate_bp >= 0 AND rate_bp <= 100000),
    start_date      TEXT NOT NULL CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    end_date        TEXT CHECK (end_date IS NULL OR end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    interest_type   TEXT NOT NULL CHECK (interest_type IN ('simple','compound_monthly','compound_daily','annuity')),
    accrual_mode    TEXT NOT NULL CHECK (accrual_mode IN ('monthly','at_maturity')),
    comment         TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
"#;

const SCHEMA_V2: &str = r#"
CREATE TABLE banks (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
);

CREATE TABLE balance_lines (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    owner    TEXT NOT NULL DEFAULT '',
    kind     TEXT NOT NULL CHECK (kind IN ('bank','cash')),
    bank_id  INTEGER REFERENCES banks(id) ON DELETE RESTRICT,
    name     TEXT NOT NULL,
    currency TEXT NOT NULL CHECK (currency IN ('KZT','USD','EUR','RUB')),
    CHECK ((kind = 'bank' AND bank_id IS NOT NULL) OR (kind = 'cash' AND bank_id IS NULL))
);

CREATE TABLE balance_snapshots_v2 (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    line_id      INTEGER NOT NULL REFERENCES balance_lines(id) ON DELETE CASCADE,
    date         TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    amount_minor INTEGER NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO banks(name) SELECT 'Не указан' WHERE EXISTS (SELECT 1 FROM balance_snapshots);
INSERT INTO balance_lines(owner, kind, bank_id, name, currency)
SELECT DISTINCT '', 'bank', (SELECT id FROM banks WHERE name = 'Не указан'), 'Основной ' || currency, currency
FROM balance_snapshots;

INSERT INTO balance_snapshots_v2(line_id, date, amount_minor, created_at)
SELECT l.id, s.date, s.amount_minor, s.created_at
FROM balance_snapshots s JOIN balance_lines l ON l.currency = s.currency;

DROP TABLE balance_snapshots;
ALTER TABLE balance_snapshots_v2 RENAME TO balance_snapshots;
CREATE UNIQUE INDEX uq_snapshot_line_date ON balance_snapshots(line_id, date);
CREATE INDEX idx_snapshot_date ON balance_snapshots(date);
"#;

const SCHEMA_V3: &str = r#"
CREATE TABLE owners (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
);
INSERT INTO owners(name) SELECT DISTINCT owner FROM balance_lines WHERE owner <> '';
ALTER TABLE balance_lines ADD COLUMN owner_id INTEGER REFERENCES owners(id) ON DELETE RESTRICT;
ALTER TABLE balance_lines ADD COLUMN region TEXT NOT NULL DEFAULT 'KZ' CHECK (region IN ('RU','KZ'));
UPDATE balance_lines SET owner_id = (SELECT id FROM owners WHERE owners.name = balance_lines.owner);
ALTER TABLE balance_lines DROP COLUMN owner;
"#;

const SCHEMA_V4: &str = r#"
ALTER TABLE balance_snapshots ADD COLUMN is_draft INTEGER NOT NULL DEFAULT 0 CHECK (is_draft IN (0,1));
"#;

const SCHEMA_V5: &str = r#"
ALTER TABLE balance_lines ADD COLUMN is_deposit INTEGER NOT NULL DEFAULT 0 CHECK (is_deposit IN (0,1));
ALTER TABLE balance_lines ADD COLUMN is_tax INTEGER NOT NULL DEFAULT 0 CHECK (is_tax IN (0,1));
ALTER TABLE balance_lines ADD COLUMN interest_rate_bps INTEGER NOT NULL DEFAULT 0;
"#;

const SCHEMA_V6: &str = r#"
ALTER TABLE balance_lines ADD COLUMN deposit_start_date TEXT;
ALTER TABLE balance_lines ADD COLUMN deposit_end_date TEXT;
ALTER TABLE balance_lines ADD COLUMN deposit_payout_mode TEXT DEFAULT 'monthly' CHECK (deposit_payout_mode IN ('monthly','at_maturity'));
"#;
