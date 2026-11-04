use anyhow::{anyhow, bail, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::dates::validate_date;
use crate::money::{format_grouped, MAX_MINOR};

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

// ---------------------------------------------------------------- банки

#[derive(Serialize)]
pub struct Bank {
    pub id: i64,
    pub name: String,
}

#[derive(Serialize)]
pub struct Owner {
    pub id: i64,
    pub name: String,
}

fn clean_text(s: &str, what: &str) -> Result<String> {
    let t = s.trim();
    if t.is_empty() || t.chars().count() > 64 {
        bail!("{what}: от 1 до 64 символов");
    }
    Ok(t.to_string())
}

fn dict_list(conn: &Connection, table: &str) -> Result<Vec<(i64, String)>> {
    let mut st = conn.prepare(&format!("SELECT id, name FROM {table} ORDER BY name COLLATE NOCASE"))?;
    let rows = st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

fn dict_taken(conn: &Connection, table: &str, name: &str, except_id: i64) -> Result<bool> {
    let lower = name.to_lowercase();
    Ok(dict_list(conn, table)?.into_iter().any(|(id, n)| id != except_id && n.to_lowercase() == lower))
}

fn dict_add(conn: &Connection, table: &str, name: &str, what: &str, dup: &str) -> Result<i64> {
    let name = clean_text(name, what)?;
    if dict_taken(conn, table, &name, -1)? {
        bail!("{}", dup);
    }
    conn.execute(&format!("INSERT INTO {table}(name) VALUES (?1)"), params![name])?;
    Ok(conn.last_insert_rowid())
}

fn dict_rename(conn: &Connection, table: &str, id: i64, name: &str, what: &str, dup: &str, nf: &str) -> Result<()> {
    let name = clean_text(name, what)?;
    if dict_taken(conn, table, &name, id)? {
        bail!("{}", dup);
    }
    let n = conn.execute(&format!("UPDATE {table} SET name = ?1 WHERE id = ?2"), params![name, id])?;
    if n == 0 {
        bail!("{}", nf);
    }
    Ok(())
}

fn dict_delete(conn: &Connection, table: &str, col: &str, id: i64, word: &str) -> Result<()> {
    let name: Option<String> = conn
        .query_row(&format!("SELECT name FROM {table} WHERE id = ?1"), params![id], |r| r.get(0))
        .optional()?;
    let name = name.ok_or_else(|| anyhow!("{word} не найден"))?;
    let n: i64 = conn.query_row(
        &format!("SELECT count(*) FROM balance_lines WHERE {col} = ?1"),
        params![id],
        |r| r.get(0),
    )?;
    if n > 0 {
        bail!("{word} «{name}» используется в счетах ({n}). Сначала удалите или измените эти счета.");
    }
    conn.execute(&format!("DELETE FROM {table} WHERE id = ?1"), params![id])?;
    Ok(())
}

pub fn list_banks(conn: &Connection) -> Result<Vec<Bank>> {
    Ok(dict_list(conn, "banks")?.into_iter().map(|(id, name)| Bank { id, name }).collect())
}
pub fn add_bank(conn: &Connection, name: &str) -> Result<i64> {
    dict_add(conn, "banks", name, "Название банка", "Такой банк уже есть в списке")
}
pub fn rename_bank(conn: &Connection, id: i64, name: &str) -> Result<()> {
    dict_rename(conn, "banks", id, name, "Название банка", "Такой банк уже есть в списке", "Банк не найден")
}
pub fn delete_bank(conn: &Connection, id: i64) -> Result<()> {
    dict_delete(conn, "banks", "bank_id", id, "Банк")
}

// ---------------------------------------------------------------- владельцы

pub fn list_owners(conn: &Connection) -> Result<Vec<Owner>> {
    Ok(dict_list(conn, "owners")?.into_iter().map(|(id, name)| Owner { id, name }).collect())
}
pub fn add_owner(conn: &Connection, name: &str) -> Result<i64> {
    dict_add(conn, "owners", name, "Имя владельца", "Такой владелец уже есть в списке")
}
pub fn rename_owner(conn: &Connection, id: i64, name: &str) -> Result<()> {
    dict_rename(conn, "owners", id, name, "Имя владельца", "Такой владелец уже есть в списке", "Владелец не найден")
}
pub fn delete_owner(conn: &Connection, id: i64) -> Result<()> {
    dict_delete(conn, "owners", "owner_id", id, "Владелец")
}

// ---------------------------------------------------------------- счета (строки баланса)

const REGIONS: [&str; 2] = ["KZ", "RU"];

fn check_region(r: &str) -> Result<()> {
    if REGIONS.contains(&r) { Ok(()) } else { bail!("Регион: RU или KZ") }
}

fn region_name(r: &str) -> &'static str {
    match r {
        "RU" => "Россия",
        "KZ" => "Казахстан",
        _ => "—",
    }
}

fn check_owner(conn: &Connection, owner_id: i64) -> Result<()> {
    let n: i64 = conn.query_row("SELECT count(*) FROM owners WHERE id = ?1", params![owner_id], |r| r.get(0))?;
    if n == 0 { bail!("Владелец не найден") }
    Ok(())
}

#[derive(Serialize)]
pub struct Line {
    pub id: i64,
    pub owner_id: Option<i64>,
    pub owner: String,
    pub region: String,
    pub region_name: String,
    pub kind: String,
    pub bank_id: Option<i64>,
    pub bank_name: Option<String>,
    pub name: String,
    pub currency: String,
    pub label: String,
}

fn make_label(owner: Option<&str>, region: &str, bank_name: Option<&str>, name: &str, currency: &str) -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Some(o) = owner {
        parts.push(o.to_string());
    }
    parts.push(region_name(region).to_string());
    parts.push(bank_name.unwrap_or("Наличные").to_string());
    format!("{} · {name} ({currency})", parts.join(" · "))
}

pub fn list_lines(conn: &Connection) -> Result<Vec<Line>> {
    let mut st = conn.prepare(
        "SELECT l.id, l.owner_id, o.name, l.region, l.kind, l.bank_id, b.name, l.name, l.currency
         FROM balance_lines l
         LEFT JOIN owners o ON o.id = l.owner_id
         LEFT JOIN banks b ON b.id = l.bank_id
         ORDER BY o.name COLLATE NOCASE, l.region, l.kind, b.name COLLATE NOCASE, l.name COLLATE NOCASE",
    )?;
    let rows = st.query_map([], |r| {
        let owner: Option<String> = r.get(2)?;
        let region: String = r.get(3)?;
        let bank_name: Option<String> = r.get(6)?;
        let name: String = r.get(7)?;
        let currency: String = r.get(8)?;
        let label = make_label(owner.as_deref(), &region, bank_name.as_deref(), &name, &currency);
        Ok(Line {
            id: r.get(0)?,
            owner_id: r.get(1)?,
            owner: owner.unwrap_or_default(),
            region_name: region_name(&region).to_string(),
            region,
            kind: r.get(4)?,
            bank_id: r.get(5)?,
            bank_name,
            name,
            currency,
            label,
        })
    })?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

fn check_bank(conn: &Connection, kind: &str, bank_id: Option<i64>) -> Result<Option<i64>> {
    match kind {
        "cash" => Ok(None),
        "bank" => {
            let id = bank_id.ok_or_else(|| anyhow!("Выберите банк"))?;
            let n: i64 = conn.query_row("SELECT count(*) FROM banks WHERE id = ?1", params![id], |r| r.get(0))?;
            if n == 0 { bail!("Банк не найден") }
            Ok(Some(id))
        }
        _ => bail!("Тип счёта: bank или cash"),
    }
}

#[allow(clippy::too_many_arguments)]
fn line_exists(
    conn: &Connection,
    owner_id: i64,
    region: &str,
    kind: &str,
    bank_id: Option<i64>,
    name: &str,
    currency: &str,
    except_id: i64,
) -> Result<bool> {
    let mut st = conn.prepare(
        "SELECT name FROM balance_lines
         WHERE owner_id IS ?1 AND region = ?2 AND kind = ?3 AND bank_id IS ?4 AND currency = ?5 AND id <> ?6",
    )?;
    let rows = st.query_map(params![owner_id, region, kind, bank_id, currency, except_id], |r| r.get::<_, String>(0))?;
    for n in rows {
        if n?.to_lowercase() == name.to_lowercase() {
            return Ok(true);
        }
    }
    Ok(false)
}

const LINE_DUP: &str = "Такой счёт уже существует (владелец, регион, банк, название и валюта совпадают)";

pub fn add_line(
    conn: &Connection,
    owner_id: i64,
    region: &str,
    kind: &str,
    bank_id: Option<i64>,
    name: &str,
    currency: &str,
) -> Result<i64> {
    let name = clean_text(name, "Название строки")?;
    check_owner(conn, owner_id)?;
    check_region(region)?;
    check_currency(currency)?;
    let bank_id = check_bank(conn, kind, bank_id)?;
    if line_exists(conn, owner_id, region, kind, bank_id, &name, currency, -1)? {
        bail!("{}", LINE_DUP);
    }
    conn.execute(
        "INSERT INTO balance_lines(owner_id, region, kind, bank_id, name, currency) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![owner_id, region, kind, bank_id, name, currency],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Тип и валюта счёта не меняются (позиции привязаны к ним); меняются владелец, регион, банк и название.
pub fn update_line(
    conn: &Connection,
    id: i64,
    owner_id: i64,
    region: &str,
    bank_id: Option<i64>,
    name: &str,
) -> Result<()> {
    let name = clean_text(name, "Название строки")?;
    check_owner(conn, owner_id)?;
    check_region(region)?;
    let cur: Option<(String, String)> = conn
        .query_row("SELECT kind, currency FROM balance_lines WHERE id = ?1", params![id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?;
    let (kind, currency) = cur.ok_or_else(|| anyhow!("Счёт не найден"))?;
    let bank_id = check_bank(conn, &kind, bank_id)?;
    if line_exists(conn, owner_id, region, &kind, bank_id, &name, &currency, id)? {
        bail!("{}", LINE_DUP);
    }
    conn.execute(
        "UPDATE balance_lines SET owner_id = ?1, region = ?2, bank_id = ?3, name = ?4 WHERE id = ?5",
        params![owner_id, region, bank_id, name, id],
    )?;
    Ok(())
}

/// Удаляет счёт вместе с его позициями.
pub fn delete_line(conn: &Connection, id: i64) -> Result<()> {
    let n = conn.execute("DELETE FROM balance_lines WHERE id = ?1", params![id])?;
    if n == 0 { bail!("Счёт не найден") }
    Ok(())
}

// ---------------------------------------------------------------- позиции баланса

#[derive(Serialize)]
pub struct Snapshot {
    pub id: i64,
    pub line_id: i64,
    pub line_label: String,
    pub date: String,
    pub currency: String,
    pub amount_minor: i64,
    pub amount: String,
}

pub fn list_snapshots(conn: &Connection) -> Result<Vec<Snapshot>> {
    let mut st = conn.prepare(
        "SELECT s.id, s.line_id, o.name, l.region, b.name, l.name, l.currency, s.date, s.amount_minor
         FROM balance_snapshots s
         JOIN balance_lines l ON l.id = s.line_id
         LEFT JOIN owners o ON o.id = l.owner_id
         LEFT JOIN banks b ON b.id = l.bank_id
         ORDER BY s.date DESC, o.name COLLATE NOCASE, b.name COLLATE NOCASE, l.name COLLATE NOCASE",
    )?;
    let rows = st.query_map([], |r| {
        let owner: Option<String> = r.get(2)?;
        let region: String = r.get(3)?;
        let bank_name: Option<String> = r.get(4)?;
        let line_name: String = r.get(5)?;
        let currency: String = r.get(6)?;
        let m: i64 = r.get(8)?;
        Ok(Snapshot {
            id: r.get(0)?,
            line_id: r.get(1)?,
            line_label: make_label(owner.as_deref(), &region, bank_name.as_deref(), &line_name, &currency),
            date: r.get(7)?,
            currency,
            amount_minor: m,
            amount: format_grouped(m),
        })
    })?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

const SNAP_DUP: &str = "Для этого счёта на эту дату позиция уже существует";

fn line_currency(conn: &Connection, line_id: i64) -> Result<String> {
    let c: Option<String> = conn
        .query_row("SELECT currency FROM balance_lines WHERE id = ?1", params![line_id], |r| r.get(0))
        .optional()?;
    c.ok_or_else(|| anyhow!("Счёт не найден"))
}

pub fn add_snapshot(conn: &Connection, line_id: i64, date: &str, amount_minor: i64) -> Result<i64> {
    validate_date(date)?;
    check_signed(amount_minor)?;
    line_currency(conn, line_id)?;
    conn.execute(
        "INSERT INTO balance_snapshots(line_id, date, amount_minor) VALUES (?1, ?2, ?3)",
        params![line_id, date, amount_minor],
    )
    .map_err(|e| db_err(e, SNAP_DUP))?;
    Ok(conn.last_insert_rowid())
}

pub fn update_snapshot(conn: &Connection, id: i64, line_id: i64, date: &str, amount_minor: i64) -> Result<()> {
    validate_date(date)?;
    check_signed(amount_minor)?;
    line_currency(conn, line_id)?;
    let n = conn
        .execute(
            "UPDATE balance_snapshots SET line_id = ?1, date = ?2, amount_minor = ?3 WHERE id = ?4",
            params![line_id, date, amount_minor, id],
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

// ---------------------------------------------------------------- актуальные остатки

#[derive(Serialize)]
pub struct LineBalance {
    pub line_id: i64,
    pub label: String,
    pub owner_id: Option<i64>,
    pub owner: String,
    pub region: String,
    pub region_name: String,
    pub place: String,
    pub name: String,
    pub currency: String,
    pub date: Option<String>,
    pub amount_minor: Option<i64>,
    pub amount: Option<String>,
}

#[derive(Serialize)]
pub struct CurrencyTotal {
    pub currency: String,
    pub amount_minor: i64,
    pub amount: String,
}

#[derive(Serialize)]
pub struct Balances {
    pub rows: Vec<LineBalance>,
    pub totals: Vec<CurrencyTotal>,
}

/// Остаток по каждому счёту = последняя позиция на дату <= as_of.
/// Счета без позиций на эту дату возвращаются с date/amount = None.
pub fn current_balances(
    conn: &Connection,
    as_of: &str,
    owner_id: Option<i64>,
    region: Option<&str>,
    hide_zero: bool,
) -> Result<Balances> {
    validate_date(as_of)?;
    if let Some(r) = region {
        check_region(r)?;
    }
    let mut st = conn.prepare(
        "SELECT l.id, l.owner_id, o.name, l.region, b.name, l.name, l.currency,
            (SELECT s.date FROM balance_snapshots s
              WHERE s.line_id = l.id AND s.date <= ?1 ORDER BY s.date DESC LIMIT 1),
            (SELECT s.amount_minor FROM balance_snapshots s
              WHERE s.line_id = l.id AND s.date <= ?1 ORDER BY s.date DESC LIMIT 1)
         FROM balance_lines l
         LEFT JOIN owners o ON o.id = l.owner_id
         LEFT JOIN banks b ON b.id = l.bank_id
         WHERE (?2 IS NULL OR l.owner_id = ?2) AND (?3 IS NULL OR l.region = ?3)
         ORDER BY o.name COLLATE NOCASE, l.region, l.kind, b.name COLLATE NOCASE, l.name COLLATE NOCASE",
    )?;
    let rows = st.query_map(params![as_of, owner_id, region], |r| {
        let owner: Option<String> = r.get(2)?;
        let region: String = r.get(3)?;
        let bank_name: Option<String> = r.get(4)?;
        let name: String = r.get(5)?;
        let currency: String = r.get(6)?;
        let amount_minor: Option<i64> = r.get(8)?;
        Ok(LineBalance {
            line_id: r.get(0)?,
            label: make_label(owner.as_deref(), &region, bank_name.as_deref(), &name, &currency),
            owner_id: r.get(1)?,
            owner: owner.unwrap_or_default(),
            region_name: region_name(&region).to_string(),
            region,
            place: bank_name.unwrap_or_else(|| "Наличные".to_string()),
            name,
            currency,
            date: r.get(7)?,
            amount_minor,
            amount: amount_minor.map(format_grouped),
        })
    })?;
    let mut out = rows.collect::<std::result::Result<Vec<_>, _>>()?;
    if hide_zero {
        out.retain(|r| r.amount_minor != Some(0));
    }

    let mut sums: Vec<(String, i64)> = Vec::new();
    for row in &out {
        if let Some(m) = row.amount_minor {
            match sums.iter_mut().find(|e| e.0 == row.currency) {
                Some(e) => e.1 = e.1.checked_add(m).ok_or_else(|| anyhow!("Переполнение суммы"))?,
                None => sums.push((row.currency.clone(), m)),
            }
        }
    }
    sums.sort_by_key(|e| CURRENCIES.iter().position(|c| *c == e.0).unwrap_or(usize::MAX));
    let totals = sums
        .into_iter()
        .map(|(currency, m)| CurrencyTotal { amount: format_grouped(m), currency, amount_minor: m })
        .collect();
    Ok(Balances { rows: out, totals })
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
            amount: format_grouped(m),
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
    fn owners_banks_lines_snapshots() {
        let c = conn();
        let me = add_owner(&c, "Костя").unwrap();
        let wife = add_owner(&c, "Жена").unwrap();
        assert!(add_owner(&c, "костя").is_err());
        let kaspi = add_bank(&c, "Kaspi").unwrap();
        assert!(add_bank(&c, "kaspi").is_err());

        let l1 = add_line(&c, me, "KZ", "bank", Some(kaspi), "Gold", "KZT").unwrap();
        let l2 = add_line(&c, me, "KZ", "bank", Some(kaspi), "Депозит", "KZT").unwrap(); // несколько строк в одном банке
        assert!(add_line(&c, me, "KZ", "bank", Some(kaspi), "gold", "KZT").is_err()); // дубль без учёта регистра
        add_line(&c, me, "RU", "bank", Some(kaspi), "Gold", "KZT").unwrap(); // другой регион — другая строка
        let cash = add_line(&c, wife, "RU", "cash", None, "Кошелёк", "RUB").unwrap();
        assert!(add_line(&c, 999, "KZ", "cash", None, "Z", "KZT").is_err()); // нет владельца
        assert!(add_line(&c, me, "XX", "cash", None, "Z", "KZT").is_err()); // нет региона
        assert!(add_line(&c, me, "KZ", "bank", None, "X", "KZT").is_err()); // банк обязателен
        assert!(add_line(&c, me, "KZ", "bank", Some(999), "X", "KZT").is_err());
        assert!(add_line(&c, me, "KZ", "cash", None, "Y", "GBP").is_err());
        assert!(delete_bank(&c, kaspi).is_err()); // банк используется
        assert!(delete_owner(&c, me).is_err()); // владелец используется

        let s1 = add_snapshot(&c, l1, "2026-10-31", 150_000_00).unwrap();
        assert!(add_snapshot(&c, l1, "2026-10-31", 1).is_err()); // дубль на дату
        add_snapshot(&c, l2, "2026-10-31", -50_00).unwrap(); // отрицательные разрешены
        add_snapshot(&c, cash, "2026-10-31", 100_00).unwrap();
        assert!(add_snapshot(&c, l1, "2026-13-01", 1).is_err());
        assert!(add_snapshot(&c, 9999, "2026-10-31", 1).is_err());

        update_snapshot(&c, s1, l1, "2026-10-30", 200_00).unwrap();
        let list = list_snapshots(&c).unwrap();
        assert_eq!(list.len(), 3);
        assert!(list.iter().any(|s| s.amount == "200.00" && s.date == "2026-10-30"));
        assert!(list.iter().any(|s| s.line_label.contains("Костя")));

        update_line(&c, l2, wife, "KZ", Some(kaspi), "Депозит 12 мес").unwrap();
        let lines = list_lines(&c).unwrap();
        assert!(lines.iter().any(|l| l.label == "Жена · Казахстан · Kaspi · Депозит 12 мес (KZT)"));

        delete_line(&c, l2).unwrap();
        assert_eq!(list_snapshots(&c).unwrap().len(), 2); // позиции удалены каскадом
        rename_bank(&c, kaspi, "Kaspi Bank").unwrap();
        rename_owner(&c, wife, "Супруга").unwrap();
        for l in list_lines(&c).unwrap() {
            delete_line(&c, l.id).unwrap();
        }
        delete_bank(&c, kaspi).unwrap();
        delete_owner(&c, me).unwrap();
        delete_owner(&c, wife).unwrap();
    }

    #[test]
    fn current_balances_work() {
        let c = conn();
        let me = add_owner(&c, "Костя").unwrap();
        let wife = add_owner(&c, "Жена").unwrap();
        let bank = add_bank(&c, "Kaspi").unwrap();
        let a = add_line(&c, me, "KZ", "bank", Some(bank), "Gold", "KZT").unwrap();
        let b = add_line(&c, me, "KZ", "bank", Some(bank), "Депозит", "KZT").unwrap();
        let w = add_line(&c, wife, "RU", "cash", None, "Кошелёк", "KZT").unwrap();
        let closed = add_line(&c, me, "KZ", "cash", None, "Старый", "USD").unwrap();
        add_snapshot(&c, a, "2026-10-01", 100_000_00).unwrap();
        add_snapshot(&c, a, "2026-11-01", 150_000_00).unwrap();
        add_snapshot(&c, b, "2026-10-15", -20_000_00).unwrap();
        add_snapshot(&c, w, "2026-10-20", 5_000_00).unwrap();
        add_snapshot(&c, closed, "2026-09-01", 10_00).unwrap();
        add_snapshot(&c, closed, "2026-10-01", 0).unwrap(); // счёт закрыт нулём

        // на 3 ноября: последняя позиция по каждому счёту, закрытый (0) скрыт
        let r = current_balances(&c, "2026-11-03", None, None, true).unwrap();
        assert_eq!(r.rows.len(), 3);
        let kzt = r.totals.iter().find(|t| t.currency == "KZT").unwrap();
        assert_eq!(kzt.amount_minor, 150_000_00 - 20_000_00 + 5_000_00);
        assert!(r.totals.iter().all(|t| t.currency != "USD")); // нулевой USD скрыт

        // на 10 октября: у депозита и кошелька ещё нет позиций
        let r2 = current_balances(&c, "2026-10-10", None, None, true).unwrap();
        assert_eq!(r2.rows.len(), 3);
        assert_eq!(r2.rows.iter().filter(|x| x.amount_minor.is_none()).count(), 2);
        assert_eq!(r2.totals.iter().find(|t| t.currency == "KZT").unwrap().amount_minor, 100_000_00);

        // фильтры
        assert_eq!(current_balances(&c, "2026-11-03", Some(wife), None, true).unwrap().rows.len(), 1);
        assert_eq!(current_balances(&c, "2026-11-03", None, Some("RU"), true).unwrap().rows.len(), 1);
        assert_eq!(current_balances(&c, "2026-11-03", None, Some("KZ"), true).unwrap().rows.len(), 2);
        assert_eq!(current_balances(&c, "2026-11-03", None, None, false).unwrap().rows.len(), 4);
        assert!(current_balances(&c, "2026-11-03", None, Some("XX"), true).is_err());
        assert!(current_balances(&c, "2026-13-03", None, None, true).is_err());

        let first = &current_balances(&c, "2026-11-03", Some(me), None, true).unwrap().rows[0];
        assert_eq!(first.amount.as_deref(), Some("150\u{a0}000.00")); // группировка тысяч
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
