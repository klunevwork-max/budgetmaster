use anyhow::{anyhow, bail, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::dates::validate_date;
use crate::money::{format_minor, MAX_MINOR};

pub const CURRENCIES: [&str; 4] = ["KZT", "USD", "EUR", "RUB"];

fn check_currency(c: &str) -> Result<()> {
    if CURRENCIES.contains(&c) { Ok(()) } else { bail!("Недопустимая валюта") }
}

fn check_kind(k: &str) -> Result<()> {
    if k == "income" || k == "expense" { Ok(()) } else { bail!("Недопустимый тип (income/expense)") }
}

fn check_signed(v: i64) -> Result<()> {
    if v.unsigned_abs() > MAX_MINOR as u64 { bail!("Слишком большая сумма") }
    Ok(())
}

fn db_err(e: rusqlite::Error, unique_msg: &str) -> anyhow::Error {
    let s = e.to_string();
    if s.contains("UNIQUE") {
        anyhow!("{}", unique_msg)
    } else if s.contains("FOREIGN KEY") {
        anyhow!("Нарушена связь с другой записью")
    } else {
        anyhow::Error::new(e)
    }
}

// ---------------------------------------------------------------- позиции баланса

#[derive(Serialize)]
pub struct Snapshot {
    pub id: i64,
    pub date: String,
    pub currency: String,
    pub amount_minor: i64,
    pub amount: String,
}

pub fn list_snapshots(conn: &Connection) -> Result<Vec<Snapshot>> {
    let mut st = conn.prepare(
        "SELECT id, date, currency, amount_minor FROM balance_snapshots ORDER BY date DESC, currency",
    )?;
    let rows = st.query_map([], |r| {
        let m: i64 = r.get(3)?;
        Ok(Snapshot { id: r.get(0)?, date: r.get(1)?, currency: r.get(2)?, amount_minor: m, amount: format_minor(m) })
    })?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

const SNAP_DUP: &str = "Позиция на эту дату и валюту уже существует";

pub fn add_snapshot(conn: &Connection, date: &str, currency: &str, amount_minor: i64) -> Result<i64> {
    validate_date(date)?;
    check_currency(currency)?;
    check_signed(amount_minor)?;
    conn.execute(
        "INSERT INTO balance_snapshots(date, currency, amount_minor) VALUES (?1, ?2, ?3)",
        params![date, currency, amount_minor],
    )
    .map_err(|e| db_err(e, SNAP_DUP))?;
    Ok(conn.last_insert_rowid())
}

pub fn update_snapshot(conn: &Connection, id: i64, date: &str, currency: &str, amount_minor: i64) -> Result<()> {
    validate_date(date)?;
    check_currency(currency)?;
    check_signed(amount_minor)?;
    let n = conn
        .execute(
            "UPDATE balance_snapshots SET date = ?1, currency = ?2, amount_minor = ?3 WHERE id = ?4",
            params![date, currency, amount_minor, id],
        )
        .map_err(|e| db_err(e, SNAP_DUP))?;
    if n == 0 { bail!("Позиция не найдена") }
    Ok(())
}

pub fn delete_snapshot(conn: &Connection, id: i64) -> Result<()> {
    let n = conn.execute("DELETE FROM balance_snapshots WHERE id = ?1", params![id])?;
    if n == 0 { bail!("Позиция не найдена") }
    Ok(())
}

// ---------------------------------------------------------------- категории

#[derive(Serialize)]
pub struct Category {
    pub id: i64,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub is_interest: bool,
}

pub fn list_categories(conn: &Connection) -> Result<Vec<Category>> {
    let mut st = conn.prepare(
        "SELECT id, name, type, is_interest FROM categories ORDER BY type, name COLLATE NOCASE",
    )?;
    let rows = st.query_map([], |r| {
        Ok(Category { id: r.get(0)?, name: r.get(1)?, kind: r.get(2)?, is_interest: r.get::<_, i64>(3)? != 0 })
    })?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

fn clean_name(name: &str) -> Result<String> {
    let n = name.trim();
    if n.is_empty() || n.chars().count() > 64 {
        bail!("Название категории: от 1 до 64 символов");
    }
    Ok(n.to_string())
}

fn count_ops(conn: &Connection, category_id: i64) -> Result<i64> {
    Ok(conn.query_row("SELECT count(*) FROM operations WHERE category_id = ?1", params![category_id], |r| r.get(0))?)
}

fn name_exists(conn: &Connection, kind: &str, name: &str, except_id: i64) -> Result<bool> {
    let lower = name.to_lowercase();
    let mut st = conn.prepare("SELECT name FROM categories WHERE type = ?1 AND id <> ?2")?;
    let names = st.query_map(params![kind, except_id], |r| r.get::<_, String>(0))?;
    for n in names {
        if n?.to_lowercase() == lower {
            return Ok(true);
        }
    }
    Ok(false)
}

pub fn add_category(conn: &Connection, name: &str, kind: &str, is_interest: bool) -> Result<i64> {
    let name = clean_name(name)?;
    check_kind(kind)?;
    if name_exists(conn, kind, &name, -1)? { bail!("Такая категория уже существует") }
    conn.execute(
        "INSERT INTO categories(name, type, is_interest) VALUES (?1, ?2, ?3)",
        params![name, kind, is_interest as i64],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn update_category(conn: &Connection, id: i64, name: &str, kind: &str, is_interest: bool) -> Result<()> {
    let name = clean_name(name)?;
    check_kind(kind)?;
    let cur: Option<String> = conn
        .query_row("SELECT type FROM categories WHERE id = ?1", params![id], |r| r.get(0))
        .optional()?;
    let cur = cur.ok_or_else(|| anyhow!("Категория не найдена"))?;
    if cur != kind {
        let n = count_ops(conn, id)?;
        if n > 0 { bail!("Нельзя изменить тип: к категории привязано {n} операций") }
    }
    if name_exists(conn, kind, &name, id)? { bail!("Такая категория уже существует") }
    conn.execute(
        "UPDATE categories SET name = ?1, type = ?2, is_interest = ?3 WHERE id = ?4",
        params![name, kind, is_interest as i64, id],
    )?;
    Ok(())
}

pub fn delete_category(conn: &Connection, id: i64) -> Result<()> {
    let name: Option<String> = conn
        .query_row("SELECT name FROM categories WHERE id = ?1", params![id], |r| r.get(0))
        .optional()?;
    let name = name.ok_or_else(|| anyhow!("Категория не найдена"))?;
    let n = count_ops(conn, id)?;
    if n > 0 {
        bail!("К категории «{name}» привязано {n} операций. Переназначьте их на другую категорию или удалите операции.");
    }
    conn.execute("DELETE FROM categories WHERE id = ?1", params![id])?;
    Ok(())
}

// ---------------------------------------------------------------- операции

#[derive(Serialize)]
pub struct Operation {
    pub id: i64,
    pub date: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub currency: String,
    pub amount_minor: i64,
    pub amount: String,
    pub category_id: Option<i64>,
    pub category_name: Option<String>,
    pub comment: Option<String>,
}

fn validate_op(
    conn: &Connection,
    date: &str,
    kind: &str,
    currency: &str,
    amount_minor: i64,
    category_id: Option<i64>,
    comment: Option<&str>,
) -> Result<Option<String>> {
    validate_date(date)?;
    check_kind(kind)?;
    check_currency(currency)?;
    if amount_minor <= 0 { bail!("Сумма операции должна быть больше нуля") }
    check_signed(amount_minor)?;
    if let Some(cid) = category_id {
        let ct: Option<String> = conn
            .query_row("SELECT type FROM categories WHERE id = ?1", params![cid], |r| r.get(0))
            .optional()?;
        match ct {
            None => bail!("Категория не найдена"),
            Some(t) if t != kind => bail!("Тип категории не совпадает с типом операции"),
            _ => {}
        }
    }
    let comment = comment.map(|c| c.trim()).filter(|c| !c.is_empty()).map(|c| c.to_string());
    if comment.as_ref().map_or(false, |c| c.chars().count() > 500) {
        bail!("Комментарий: не более 500 символов");
    }
    Ok(comment)
}

pub fn add_operation(
    conn: &Connection,
    date: &str,
    kind: &str,
    currency: &str,
    amount_minor: i64,
    category_id: Option<i64>,
    comment: Option<&str>,
) -> Result<i64> {
    let comment = validate_op(conn, date, kind, currency, amount_minor, category_id, comment)?;
    conn.execute(
        "INSERT INTO operations(date, type, currency, amount_minor, category_id, comment) VALUES (?1,?2,?3,?4,?5,?6)",
        params![date, kind, currency, amount_minor, category_id, comment],
    )
    .map_err(|e| db_err(e, "Такая операция уже существует"))?;
    Ok(conn.last_insert_rowid())
}

pub fn update_operation(
    conn: &Connection,
    id: i64,
    date: &str,
    kind: &str,
    currency: &str,
    amount_minor: i64,
    category_id: Option<i64>,
    comment: Option<&str>,
) -> Result<()> {
    let comment = validate_op(conn, date, kind, currency, amount_minor, category_id, comment)?;
    let n = conn
        .execute(
            "UPDATE operations SET date=?1, type=?2, currency=?3, amount_minor=?4, category_id=?5, comment=?6 WHERE id=?7",
            params![date, kind, currency, amount_minor, category_id, comment, id],
        )
        .map_err(|e| db_err(e, "Такая операция уже существует"))?;
    if n == 0 { bail!("Операция не найдена") }
    Ok(())
}

pub fn delete_operation(conn: &Connection, id: i64) -> Result<()> {
    let n = conn.execute("DELETE FROM operations WHERE id = ?1", params![id])?;
    if n == 0 { bail!("Операция не найдена") }
    Ok(())
}

pub fn list_operations(
    conn: &Connection,
    from: Option<&str>,
    to: Option<&str>,
    kind: Option<&str>,
    category_id: Option<i64>,
) -> Result<Vec<Operation>> {
    if let Some(d) = from { validate_date(d)? }
    if let Some(d) = to { validate_date(d)? }
    if let Some(k) = kind { check_kind(k)? }
    let mut st = conn.prepare(
        "SELECT o.id, o.date, o.type, o.currency, o.amount_minor, o.category_id, c.name, o.comment
         FROM operations o LEFT JOIN categories c ON c.id = o.category_id
         WHERE (?1 IS NULL OR o.date >= ?1)
           AND (?2 IS NULL OR o.date <= ?2)
           AND (?3 IS NULL OR o.type = ?3)
           AND (?4 IS NULL OR o.category_id = ?4)
         ORDER BY o.date DESC, o.id DESC",
    )?;
    let rows = st.query_map(params![from, to, kind, category_id], |r| {
        let m: i64 = r.get(4)?;
        Ok(Operation {
            id: r.get(0)?,
            date: r.get(1)?,
            kind: r.get(2)?,
            currency: r.get(3)?,
            amount_minor: m,
            amount: format_minor(m),
            category_id: r.get(5)?,
            category_name: r.get(6)?,
            comment: r.get(7)?,
        })
    })?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrate(&c).unwrap();
        c
    }

    #[test]
    fn snapshots() {
        let c = conn();
        let id = add_snapshot(&c, "2026-10-31", "KZT", 150_000_00).unwrap();
        assert!(add_snapshot(&c, "2026-10-31", "KZT", 1).is_err()); // дубль
        add_snapshot(&c, "2026-10-31", "USD", -50_00).unwrap(); // отрицательные разрешены
        assert!(add_snapshot(&c, "2026-13-01", "KZT", 1).is_err());
        assert!(add_snapshot(&c, "2026-10-31", "GBP", 1).is_err());
        update_snapshot(&c, id, "2026-10-30", "KZT", 200_00).unwrap();
        let list = list_snapshots(&c).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].date, "2026-10-31");
        assert_eq!(list[1].amount, "200.00");
        delete_snapshot(&c, id).unwrap();
        assert!(delete_snapshot(&c, id).is_err());
    }

    #[test]
    fn categories_and_operations() {
        let c = conn();
        let food = add_category(&c, "Еда", "expense", false).unwrap();
        let sal = add_category(&c, "Зарплата", "income", false).unwrap();
        assert!(add_category(&c, "еда", "expense", false).is_err()); // дубль без учёта регистра
        add_category(&c, "Еда", "income", false).unwrap(); // другой тип — можно

        add_operation(&c, "2026-11-01", "expense", "KZT", 5_000_00, Some(food), Some("  обед ")).unwrap();
        let op2 = add_operation(&c, "2026-11-02", "income", "USD", 100_00, Some(sal), None).unwrap();
        assert!(add_operation(&c, "2026-11-02", "income", "KZT", 1, Some(food), None).is_err()); // тип не совпал
        assert!(add_operation(&c, "2026-11-02", "expense", "KZT", 0, None, None).is_err()); // сумма 0
        assert!(add_operation(&c, "2026-11-02", "expense", "KZT", 1, Some(9999), None).is_err()); // нет категории

        // удаление категории с операциями запрещено
        let err = delete_category(&c, food).unwrap_err().to_string();
        assert!(err.contains("привязана") || err.contains("привязано"), "{err}");
        // смена типа категории с операциями запрещена
        assert!(update_category(&c, food, "Еда", "income", false).is_err());
        update_category(&c, food, "Питание", "expense", true).unwrap();

        // фильтры
        assert_eq!(list_operations(&c, None, None, None, None).unwrap().len(), 2);
        assert_eq!(list_operations(&c, Some("2026-11-02"), None, None, None).unwrap().len(), 1);
        assert_eq!(list_operations(&c, None, None, Some("expense"), None).unwrap().len(), 1);
        assert_eq!(list_operations(&c, None, None, None, Some(sal)).unwrap().len(), 1);
        let first = list_operations(&c, None, None, Some("expense"), None).unwrap();
        assert_eq!(first[0].comment.as_deref(), Some("обед"));
        assert_eq!(first[0].category_name.as_deref(), Some("Питание"));

        delete_operation(&c, op2).unwrap();
        delete_category(&c, sal).unwrap(); // теперь можно
    }
}
