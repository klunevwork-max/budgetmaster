use anyhow::{anyhow, bail, Result};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::HashMap;

use crate::data::CURRENCIES;
use crate::dates::validate_date;
use crate::money::{div_round_half_even, format_grouped};
use crate::rates::{self, Rate, SCALE};

pub struct Period {
    pub start: String,
    pub end: String,
    pub auto: bool,
    pub no_earlier: bool,
}

#[derive(Serialize)]
pub struct ReportCurrency {
    pub currency: String,
    pub start: String,
    pub end: String,
    pub delta: String,
}

#[derive(Serialize)]
pub struct OpsCurrency {
    pub currency: String,
    pub income: String,
    pub expense: String,
}

#[derive(Serialize)]
pub struct ReportRate {
    pub kind: String,
    pub currency: String,
    pub rate: String,
    pub source_date: String,
    pub source: String,
    pub gap_days: i64,
}

#[derive(Serialize)]
pub struct Report {
    pub start_date: String,
    pub end_date: String,
    pub auto_start: bool,
    pub currencies: Vec<ReportCurrency>,
    pub delta_with_reval: Option<String>,
    pub delta_no_reval: Option<String>,
    pub reval_effect: Option<String>,
    pub ops_income: String,
    pub ops_expense: String,
    pub ops_net: String,
    pub ops_count: usize,
    pub ops_excluded: usize,
    pub ops_by_currency: Vec<OpsCurrency>,
    pub virtual_monthly: String,
    pub unmarked_with_reval: Option<String>,
    pub unmarked_no_reval: Option<String>,
    pub rates: Vec<ReportRate>,
    pub warnings: Vec<String>,
}

fn cur_pos(c: &str) -> usize {
    CURRENCIES.iter().position(|x| *x == c).unwrap_or(usize::MAX)
}

fn fmt_rate(rs: i64) -> String {
    format!("{}.{:04}", rs / SCALE, (rs % SCALE) / 100)
}

/// Значение в масштабе 1e6 -> строка с одним банковским округлением.
fn scaled_str(v: i128) -> Result<String> {
    let m = i64::try_from(div_round_half_even(v, SCALE as i128)).map_err(|_| anyhow!("Переполнение суммы"))?;
    Ok(format_grouped(m))
}

fn report_rate(kind: &str, cur: &str, r: &Rate, as_of: &str) -> ReportRate {
    ReportRate {
        kind: kind.to_string(),
        currency: cur.to_string(),
        rate: fmt_rate(r.rate_scaled),
        source_date: r.source_date.clone(),
        source: r.source.clone(),
        gap_days: rates::gap_days(as_of, &r.source_date),
    }
}

/// Период (start, end]. Без start берётся ближайшая более ранняя дата с позициями.
pub fn resolve_period(conn: &Connection, end: &str, start: Option<&str>) -> Result<Period> {
    validate_date(end)?;
    match start {
        Some(s) => {
            validate_date(s)?;
            if s >= end {
                bail!("Дата начала должна быть раньше даты отчёта");
            }
            Ok(Period { start: s.to_string(), end: end.to_string(), auto: false, no_earlier: false })
        }
        None => {
            let prev: Option<String> = conn.query_row(
                "SELECT max(date) FROM balance_snapshots WHERE date < ?1 AND is_draft = 0",
                params![end],
                |r| r.get(0),
            )?;
            Ok(match prev {
                Some(d) => Period { start: d, end: end.to_string(), auto: true, no_earlier: false },
                None => Period { start: end.to_string(), end: end.to_string(), auto: true, no_earlier: true },
            })
        }
    }
}

/// Даты, на которые нужны курсы: начало, конец и даты операций периода в валюте, отличной от KZT.
pub fn needed_dates(conn: &Connection, p: &Period) -> Result<Vec<String>> {
    let mut v = vec![p.start.clone(), p.end.clone()];
    let mut st = conn.prepare(
        "SELECT DISTINCT date FROM operations WHERE date > ?1 AND date <= ?2 AND currency <> 'KZT'",
    )?;
    let rows = st.query_map(params![p.start, p.end], |r| r.get::<_, String>(0))?;
    for d in rows {
        v.push(d?);
    }
    v.sort();
    v.dedup();
    Ok(v)
}

fn line_currencies(conn: &Connection) -> Result<Vec<String>> {
    let mut st = conn.prepare("SELECT DISTINCT currency FROM balance_lines")?;
    let mut v = st
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<String>, _>>()?;
    v.sort_by_key(|c| cur_pos(c));
    Ok(v)
}

/// Остаток по валюте = сумма последних известных позиций каждого счёта на дату <= date.
fn balances_on(conn: &Connection, date: &str) -> Result<HashMap<String, i64>> {
    let mut st = conn.prepare(
        "SELECT l.currency,
                sum((SELECT s.amount_minor FROM balance_snapshots s
                      WHERE s.line_id = l.id AND s.date <= ?1 AND s.is_draft = 0 ORDER BY s.date DESC LIMIT 1))
         FROM balance_lines l GROUP BY l.currency",
    )?;
    let rows = st.query_map(params![date], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, Option<i64>>(1)?.unwrap_or(0)))
    })?;
    Ok(rows.collect::<std::result::Result<HashMap<_, _>, _>>()?)
}

fn snapshot_warning(conn: &Connection, label: &str, date: &str, warnings: &mut Vec<String>) -> Result<()> {
    let last: Option<String> = conn.query_row(
        "SELECT max(date) FROM balance_snapshots WHERE date <= ?1 AND is_draft = 0",
        params![date],
        |r| r.get(0),
    )?;
    match last {
        Some(d) if d == date => {}
        Some(d) => warnings.push(format!(
            "На {label} ({date}) нет позиций: использованы последние известные (от {d})"
        )),
        None => warnings.push(format!(
            "На {label} ({date}) нет ни одной позиции: остатки считаются нулевыми"
        )),
    }
    Ok(())
}

struct RateBook<'a> {
    conn: &'a Connection,
    cache: HashMap<(String, String), Option<Rate>>,
}

impl<'a> RateBook<'a> {
    fn new(conn: &'a Connection) -> Self {
        RateBook { conn, cache: HashMap::new() }
    }

    fn get(&mut self, cur: &str, date: &str) -> Result<Option<Rate>> {
        let key = (cur.to_string(), date.to_string());
        if let Some(v) = self.cache.get(&key) {
            return Ok(v.clone());
        }
        let v = rates::lookup(self.conn, cur, date)?;
        self.cache.insert(key, v.clone());
        Ok(v)
    }
}

pub fn build(conn: &Connection, p: &Period) -> Result<Report> {
    let mut warnings: Vec<String> = Vec::new();
    if p.no_earlier {
        warnings.push(
            "Нет позиций раньше даты отчёта: период пустой, изменения нулевые. Добавьте более ранние позиции или выберите дату начала вручную."
                .to_string(),
        );
    } else {
        snapshot_warning(conn, "начало периода", &p.start, &mut warnings)?;
    }
    snapshot_warning(conn, "конец периода", &p.end, &mut warnings)?;

    let currencies = line_currencies(conn)?;
    let bal_start = balances_on(conn, &p.start)?;
    let bal_end = balances_on(conn, &p.end)?;
    let mut book = RateBook::new(conn);

    // ---- блоки 1 и 2: изменение по валютам и в KZT
    let (mut with_end, mut with_start, mut no_reval) = (0i128, 0i128, 0i128);
    let (mut ok_with, mut ok_no) = (true, true);
    let mut used: Vec<ReportRate> = Vec::new();
    let mut rows: Vec<ReportCurrency> = Vec::new();

    for cur in &currencies {
        let bs = bal_start.get(cur).copied().unwrap_or(0);
        let be = bal_end.get(cur).copied().unwrap_or(0);
        let delta = be.checked_sub(bs).ok_or_else(|| anyhow!("Переполнение суммы"))?;
        rows.push(ReportCurrency {
            currency: cur.clone(),
            start: format_grouped(bs),
            end: format_grouped(be),
            delta: format_grouped(delta),
        });

        if be != 0 || delta != 0 {
            match book.get(cur, &p.end)? {
                Some(r) => {
                    with_end += be as i128 * r.rate_scaled as i128;
                    no_reval += delta as i128 * r.rate_scaled as i128;
                    if cur.as_str() != "KZT" {
                        used.push(report_rate("конец", cur, &r, &p.end));
                    }
                }
                None => {
                    ok_with = false;
                    ok_no = false;
                    warnings.push(format!("Нет курса {cur} на {}", p.end));
                }
            }
        }
        if bs != 0 {
            match book.get(cur, &p.start)? {
                Some(r) => {
                    with_start += bs as i128 * r.rate_scaled as i128;
                    if cur.as_str() != "KZT" {
                        used.push(report_rate("начало", cur, &r, &p.start));
                    }
                }
                None => {
                    ok_with = false;
                    warnings.push(format!("Нет курса {cur} на {}", p.start));
                }
            }
        }
    }

    for u in &used {
        if u.gap_days > 7 || u.source == "cache_prev" {
            let date = if u.kind == "конец" { &p.end } else { &p.start };
            warnings.push(format!(
                "Курс {} на {} ({}): {}, разрыв {} дн.",
                u.currency,
                date,
                u.kind,
                if u.source == "cache_prev" { "из кэша, не обновлён" } else { "курс предыдущего дня" },
                u.gap_days
            ));
        }
    }

    let delta_with = with_end - with_start;

    // ---- блок 3: операции периода (start, end]
    let mut st = conn.prepare(
        "SELECT currency, date, type, sum(amount_minor), count(*) FROM operations
         WHERE date > ?1 AND date <= ?2 GROUP BY currency, date, type",
    )?;
    let ops: Vec<(String, String, String, i64, usize)> = st
        .query_map(params![p.start, p.end], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get::<_, i64>(4)? as usize))
        })?
        .collect::<std::result::Result<_, _>>()?;

    let (mut inc_scaled, mut exp_scaled) = (0i128, 0i128);
    let (mut ops_count, mut excluded, mut approx) = (0usize, 0usize, 0usize);
    let mut by_cur: HashMap<String, (i64, i64)> = HashMap::new();
    for (cur, date, kind, sum, cnt) in ops {
        ops_count += cnt;
        let e = by_cur.entry(cur.clone()).or_insert((0, 0));
        if kind == "income" {
            e.0 = e.0.checked_add(sum).ok_or_else(|| anyhow!("Переполнение суммы"))?;
        } else {
            e.1 = e.1.checked_add(sum).ok_or_else(|| anyhow!("Переполнение суммы"))?;
        }
        match book.get(&cur, &date)? {
            Some(rate) => {
                if rate.source == "cache_prev" || rates::gap_days(&date, &rate.source_date) > 7 {
                    approx += cnt;
                }
                let v = sum as i128 * rate.rate_scaled as i128;
                if kind == "income" {
                    inc_scaled += v;
                } else {
                    exp_scaled += v;
                }
            }
            None => excluded += cnt,
        }
    }
    if approx > 0 {
        warnings.push(format!(
            "По {approx} операциям курс взят не на дату операции (кэш или разрыв больше 7 дней)"
        ));
    }
    if excluded > 0 {
        warnings.push(format!(
            "{excluded} операций исключены из расчёта: нет курса. Неразмеченная разница не рассчитана."
        ));
    }
    let ops_net = inc_scaled - exp_scaled;

    let mut ops_by_currency: Vec<(String, (i64, i64))> = by_cur.into_iter().collect();
    ops_by_currency.sort_by_key(|e| cur_pos(&e.0));

    // ---- блок 4: неразмеченная разница (виртуальные начисления по депозитам/кредитам пока = 0)
    let virtual_monthly: i128 = 0;
    let unmarked_with = if ok_with { Some(scaled_str(delta_with - ops_net - virtual_monthly)?) } else { None };
    let unmarked_no = if ok_no { Some(scaled_str(no_reval - ops_net - virtual_monthly)?) } else { None };

    Ok(Report {
        start_date: p.start.clone(),
        end_date: p.end.clone(),
        auto_start: p.auto,
        currencies: rows,
        delta_with_reval: if ok_with { Some(scaled_str(delta_with)?) } else { None },
        delta_no_reval: if ok_no { Some(scaled_str(no_reval)?) } else { None },
        reval_effect: if ok_with && ok_no { Some(scaled_str(delta_with - no_reval)?) } else { None },
        ops_income: scaled_str(inc_scaled)?,
        ops_expense: scaled_str(exp_scaled)?,
        ops_net: scaled_str(ops_net)?,
        ops_count,
        ops_excluded: excluded,
        ops_by_currency: ops_by_currency
            .into_iter()
            .map(|(currency, (i, e))| OpsCurrency { currency, income: format_grouped(i), expense: format_grouped(e) })
            .collect(),
        virtual_monthly: format_grouped(0),
        unmarked_with_reval: unmarked_with,
        unmarked_no_reval: unmarked_no,
        rates: used,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data;
    use crate::db::migrate;

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrate(&c).unwrap();
        c
    }

    fn seed(c: &Connection) {
        let me = data::add_owner(c, "Костя").unwrap();
        let kzt = data::add_line(c, me, "KZ", "cash", None, "Нал KZT", "KZT").unwrap();
        let usd = data::add_line(c, me, "KZ", "cash", None, "Нал USD", "USD").unwrap();
        data::add_snapshot(c, kzt, "2026-10-01", 100_000_000).unwrap(); // 1 000 000.00
        data::add_snapshot(c, usd, "2026-10-01", 100_000).unwrap(); // 1 000.00 USD
        data::add_snapshot(c, kzt, "2026-11-01", 90_000_000).unwrap();
        data::add_snapshot(c, usd, "2026-11-01", 120_000).unwrap(); // 1 200.00 USD
        data::add_operation(c, "2026-10-10", "expense", "KZT", 5_000_000, None, None).unwrap();
        data::add_operation(c, "2026-10-20", "expense", "USD", 10_000, None, None).unwrap();
        data::add_operation(c, "2026-10-25", "income", "KZT", 20_000_000, None, None).unwrap();
        // на дату начала — не входит в период (start, end]
        data::add_operation(c, "2026-10-01", "expense", "KZT", 999_999_999, None, None).unwrap();
    }

    fn seed_rates(c: &Connection) {
        rates::store(c, "USD", "2026-10-01", "2026-10-01", 450_000_000, "nbrk", 0).unwrap();
        rates::store(c, "USD", "2026-10-20", "2026-10-20", 460_000_000, "nbrk", 0).unwrap();
        rates::store(c, "USD", "2026-11-01", "2026-11-01", 480_000_000, "nbrk", 0).unwrap();
    }

    #[test]
    fn report_numbers() {
        let c = conn();
        seed(&c);
        seed_rates(&c);
        let p = resolve_period(&c, "2026-11-01", None).unwrap();
        assert_eq!((p.start.as_str(), p.auto, p.no_earlier), ("2026-10-01", true, false));
        let r = build(&c, &p).unwrap();

        // блок 1
        let usd = r.currencies.iter().find(|x| x.currency == "USD").unwrap();
        assert_eq!((usd.start.as_str(), usd.end.as_str(), usd.delta.as_str()), ("1\u{a0}000.00", "1\u{a0}200.00", "200.00"));
        let kzt = r.currencies.iter().find(|x| x.currency == "KZT").unwrap();
        assert_eq!(kzt.delta, "-100\u{a0}000.00");

        // блок 2: с переоценкой 147 600 000 - 145 000 000 = 2 600 000 минорных
        assert_eq!(r.delta_with_reval.as_deref(), Some("26\u{a0}000.00"));
        assert_eq!(r.delta_no_reval.as_deref(), Some("-4\u{a0}000.00"));
        assert_eq!(r.reval_effect.as_deref(), Some("30\u{a0}000.00")); // 1000 USD * (480 - 450)

        // блок 3
        assert_eq!(r.ops_count, 3); // операция на дату начала не учтена
        assert_eq!(r.ops_income, "200\u{a0}000.00");
        assert_eq!(r.ops_expense, "96\u{a0}000.00"); // 50 000 + 100 USD * 460
        assert_eq!(r.ops_net, "104\u{a0}000.00");
        let ou = r.ops_by_currency.iter().find(|x| x.currency == "USD").unwrap();
        assert_eq!((ou.income.as_str(), ou.expense.as_str()), ("0.00", "100.00"));

        // блок 4
        assert_eq!(r.unmarked_with_reval.as_deref(), Some("-78\u{a0}000.00"));
        assert_eq!(r.unmarked_no_reval.as_deref(), Some("-108\u{a0}000.00"));
        assert!(r.warnings.is_empty(), "{:?}", r.warnings);
        assert_eq!(r.rates.len(), 2); // USD на начало и на конец

        // операция на дату конца входит в период
        data::add_operation(&c, "2026-11-01", "expense", "KZT", 100, None, None).unwrap();
        assert_eq!(build(&c, &p).unwrap().ops_count, 4);
    }

    #[test]
    fn missing_rates_block_unmarked() {
        let c = conn();
        seed(&c); // курсов нет
        let p = resolve_period(&c, "2026-11-01", None).unwrap();
        let r = build(&c, &p).unwrap();
        assert!(r.delta_with_reval.is_none() && r.delta_no_reval.is_none() && r.reval_effect.is_none());
        assert!(r.unmarked_with_reval.is_none() && r.unmarked_no_reval.is_none());
        assert_eq!(r.ops_excluded, 1); // USD-операция
        assert!(r.warnings.iter().any(|w| w.contains("Нет курса USD")));
        // блок 1 при этом считается
        assert_eq!(r.currencies.len(), 2);
    }

    #[test]
    fn period_rules_and_dates() {
        let c = conn();
        seed(&c);
        // ручное начало
        let p = resolve_period(&c, "2026-11-01", Some("2026-09-01")).unwrap();
        assert!(!p.auto);
        assert!(resolve_period(&c, "2026-11-01", Some("2026-11-01")).is_err());
        assert!(resolve_period(&c, "2026-13-01", None).is_err());
        // раньше первой позиции: пустой период
        let p0 = resolve_period(&c, "2026-09-15", None).unwrap();
        assert!(p0.no_earlier && p0.start == p0.end);
        let r0 = build(&c, &p0).unwrap();
        assert_eq!(r0.ops_count, 0);
        assert!(r0.warnings.iter().any(|w| w.contains("раньше даты отчёта")));

        // нужные даты курсов: начало, конец и день USD-операции (KZT-операции не нужны)
        let p = resolve_period(&c, "2026-11-01", None).unwrap();
        let d = needed_dates(&c, &p).unwrap();
        assert_eq!(d, vec!["2026-10-01".to_string(), "2026-10-20".to_string(), "2026-11-01".to_string()]);
    }

    #[test]
    fn drafts_are_ignored() {
        let c = conn();
        seed(&c);
        seed_rates(&c);
        // черновик на 1 декабря (копия остатков на 1 ноября) не должен стать концом или началом периода
        crate::data::copy_balances_to_date(&c, "2026-12-01").unwrap();
        let p = resolve_period(&c, "2026-12-01", None).unwrap();
        assert_eq!(p.start, "2026-11-01"); // последняя подтверждённая позиция
        let r = build(&c, &p).unwrap();
        assert!(r.warnings.iter().any(|w| w.contains("нет позиций")));
        assert_eq!(r.delta_no_reval.as_deref(), Some("0.00"));
    }

    #[test]
    fn end_without_snapshot_uses_last_known() {
        let c = conn();
        seed(&c);
        seed_rates(&c);
        let p = resolve_period(&c, "2026-11-15", None).unwrap();
        assert_eq!(p.start, "2026-11-01");
        let r = build(&c, &p).unwrap();
        assert!(r.warnings.iter().any(|w| w.contains("нет позиций")));
        // остатки не изменились — изменение нулевое, но курс на 15.11 взят из кэша (разрыв 14 дн.)
        assert_eq!(r.delta_no_reval.as_deref(), Some("0.00"));
        assert!(r.warnings.iter().any(|w| w.contains("из кэша")));
    }
}

// Расчет виртуальных начислений процентов по депозитам за период отчета
pub fn calculate_virtual_accruals(
    conn: &Connection, 
    start_date: &str, 
    end_date: &str
) -> Result<i64> {
    let mut stmt = conn.prepare(
        "SELECT l.amount_minor, line.interest_rate_bps 
         FROM balance_snapshots l
         JOIN balance_lines line ON line.id = l.line_id
         WHERE line.is_deposit = 1 AND line.interest_rate_bps > 0 AND l.date = ?1 AND l.is_draft = 0"
    )?;
    
    let start = chrono::NaiveDate::parse_from_str(start_date, "%Y-%m-%d")?;
    let end = chrono::NaiveDate::parse_from_str(end_date, "%Y-%m-%d")?;
    let days = (end - start).num_days().max(0) as i64;

    let rows = stmt.query_map(params![start_date], |r| {
        let amount: i64 = r.get(0)?;
        let rate_bps: i64 = r.get(1)?;
        Ok((amount, rate_bps))
    })?;

    let mut total_accrued: i64 = 0;
    for row in rows {
        let (amount, rate_bps) = row?;
        // Формула: Сумма * (ставка / 10000) * (дни / 365)
        let accrued = amount * rate_bps * days / (365 * 10000);
        total_accrued += accrued;
    }

    Ok(total_accrued)
}
