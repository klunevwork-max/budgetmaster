use anyhow::{anyhow, bail, Result};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::HashMap;
use chrono::Datelike;

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
    pub deposit_real_income: String,
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

pub struct DepositAccrualResult {
    pub real_income: i128,
    pub virtual_accrual: i128,
}

pub fn calculate_deposit_accruals(
    conn: &Connection, 
    report_end_date: &str
) -> Result<DepositAccrualResult> {
    let mut stmt = conn.prepare(
        "SELECT l.id, l.currency, 
                (SELECT s.amount_minor FROM balance_snapshots s WHERE s.line_id = l.id AND s.date <= ?1 AND s.is_draft = 0 ORDER BY s.date DESC LIMIT 1) as current_amount,
                l.interest_rate_bps, 
                COALESCE(l.deposit_start_date, '2026-11-01'), 
                l.deposit_end_date, 
                COALESCE(l.deposit_payout_mode, 'monthly')
         FROM balance_lines l
         WHERE l.is_deposit = 1 AND l.interest_rate_bps > 0"
    )?;

    let report_end = chrono::NaiveDate::parse_from_str(report_end_date, "%Y-%m-%d")?;
    let mut real_total: i128 = 0;
    let mut virtual_total: i128 = 0;

    let rows = stmt.query_map(params![report_end_date], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, Option<i64>>(2)?.unwrap_or(0),
            r.get::<_, i64>(3)?,
            r.get::<_, String>(4)?,
            r.get::<_, Option<String>>(5)?,
            r.get::<_, String>(6)?,
        ))
    })?;

    for row in rows {
        let (_id, _currency, amount, rate_bps, start_str, end_opt, payout_mode) = row?;
        if amount <= 0 { continue; }

        let start_date = chrono::NaiveDate::parse_from_str(&start_str, "%Y-%m-%d")?;
        let end_date = match &end_opt {
            Some(e) if !e.is_empty() => chrono::NaiveDate::parse_from_str(e, "%Y-%m-%d")?,
            _ => report_end,
        };

        if start_date >= report_end { continue; }

        if payout_mode == "at_maturity" {
            let maturity_date = match &end_opt {
                Some(e) if !e.is_empty() => chrono::NaiveDate::parse_from_str(e, "%Y-%m-%d").unwrap_or(start_date),
                _ => start_date + chrono::Duration::days(365),
            };

            if start_date >= report_end { continue; }

            let target_date = report_end.min(maturity_date);
            let days = (target_date - start_date).num_days().max(0) as i128;
            let accrued = (amount as i128 * rate_bps as i128 * days) / (365 * 10000);

            if report_end >= maturity_date {
                real_total += accrued;
            } else {
                virtual_total += accrued;
            }
        } else {
            let limit_date = report_end.min(end_date);
            let mut curr = chrono::NaiveDate::from_ymd_opt(start_date.year(), start_date.month(), 1).unwrap();
            if curr < start_date {
                curr = curr.succ_opt().unwrap();
            }

            while curr <= limit_date {
                let prev_month_start = chrono::NaiveDate::from_ymd_opt(
                    if curr.month() == 1 { curr.year() - 1 } else { curr.year() },
                    if curr.month() == 1 { 12 } else { curr.month() - 1 },
                    1
                ).unwrap().max(start_date);

                let days_in_period = (curr - prev_month_start).num_days().max(0) as i128;
                let monthly_accrued = (amount as i128 * rate_bps as i128 * days_in_period) / (365 * 10000);

                if curr <= report_end {
                    real_total += monthly_accrued;
                } else {
                    virtual_total += monthly_accrued;
                }

                curr = if curr.month() == 12 {
                    chrono::NaiveDate::from_ymd_opt(curr.year() + 1, 1, 1).unwrap()
                } else {
                    chrono::NaiveDate::from_ymd_opt(curr.year(), curr.month() + 1, 1).unwrap()
                };
            }
        }
    }

    Ok(DepositAccrualResult {
        real_income: real_total,
        virtual_accrual: virtual_total,
    })
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

    let delta_with = with_end - with_start;

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
    let (mut ops_count, mut excluded) = (0usize, 0usize);
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

    let deposits = calculate_deposit_accruals(conn, &p.end)?;
    let ops_net = inc_scaled + deposits.real_income - exp_scaled;

    let mut ops_by_currency: Vec<(String, (i64, i64))> = by_cur.into_iter().collect();
    ops_by_currency.sort_by_key(|e| cur_pos(&e.0));

    let virtual_monthly = deposits.virtual_accrual;
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
        deposit_real_income: scaled_str(deposits.real_income)?,
        ops_net: scaled_str(ops_net)?,
        ops_count,
        ops_excluded: excluded,
        ops_by_currency: ops_by_currency
            .into_iter()
            .map(|(currency, (i, e))| OpsCurrency { currency, income: format_grouped(i), expense: format_grouped(e) })
            .collect(),
        virtual_monthly: scaled_str(virtual_monthly)?,
        unmarked_with_reval: unmarked_with,
        unmarked_no_reval: unmarked_no,
        rates: used,
        warnings,
    })
}
