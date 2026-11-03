use anyhow::{bail, Result};
use rusqlite::Connection;
use std::path::Path;

use crate::kdf::key_pragma;

pub const LATEST_VERSION: i64 = 1;

pub fn open_with_key(path: &Path, key: &[u8; 32], salt: &[u8; 16]) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(&key_pragma(key, salt))?;
    // Проверка пароля = успешное чтение sqlite_master
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    Ok(conn)
}

pub fn migrate(conn: &Connection) -> Result<()> {
    let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if v > LATEST_VERSION {
        bail!("База создана более новой версией приложения");
    }
    if v < 1 {
        let sql = format!("BEGIN;\n{SCHEMA_V1}\nPRAGMA user_version = 1;\nCOMMIT;");
        if let Err(e) = conn.execute_batch(&sql) {
            let _ = conn.execute_batch("ROLLBACK;");
            return Err(e.into());
        }
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
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (interest_type != 'annuity' OR end_date IS NOT NULL),
    CHECK (accrual_mode != 'at_maturity' OR end_date IS NOT NULL),
    CHECK (
        (interest_type IN ('compound_monthly','compound_daily') AND rate_bp <= 10000)
     OR (interest_type IN ('simple','annuity') AND rate_bp <= 100000)
    ),
    CHECK (
        (kind = 'deposit' AND interest_type IN ('simple','compound_monthly','compound_daily'))
     OR (kind = 'loan'    AND interest_type = 'annuity' AND accrual_mode = 'monthly')
     OR (kind = 'loan'    AND interest_type = 'simple'  AND accrual_mode IN ('monthly','at_maturity'))
    )
);
"#;
