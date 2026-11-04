use anyhow::{anyhow, bail, Result};
use chrono::{Duration, NaiveDate};
use rusqlite::{params, Connection, OptionalExtension};

use crate::dates::validate_date;

pub const FOREIGN: [&str; 3] = ["USD", "EUR", "RUB"];
/// Курс хранится как KZT за 1 единицу валюты × 1 000 000.
pub const SCALE: i64 = 1_000_000;
const MAX_BACK_DAYS: i64 = 10;

#[derive(Clone, Debug)]
pub struct Rate {
    pub rate_scaled: i64,
    pub source_date: String,
    /// "nbrk" | "nbrk_prev" | "cache_prev" (последний — только из памяти, в БД не пишется)
    pub source: String,
}

pub fn today() -> String {
    chrono::Local::now().date_naive().format("%Y-%m-%d").to_string()
}

fn parse_date(s: &str) -> Result<NaiveDate> {
    validate_date(s)?;
    NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|_| anyhow!("Некорректная дата"))
}

pub fn gap_days(as_of: &str, source_date: &str) -> i64 {
    match (parse_date(as_of), parse_date(source_date)) {
        (Ok(a), Ok(b)) => (a - b).num_days(),
        _ => 0,
    }
}

// ---------------------------------------------------------------- разбор ответа НБРК

/// "480.55" / "5,5" / "0.1234567" -> значение × 1e6 (седьмой знак округляется).
pub fn parse_decimal_scaled(input: &str) -> Result<i64> {
    let s = input.trim().replace(',', ".");
    let mut parts = s.split('.');
    let int_part = parts.next().unwrap_or("");
    let frac_part = parts.next().unwrap_or("");
    if parts.next().is_some() || (int_part.is_empty() && frac_part.is_empty()) {
        bail!("Некорректное число");
    }
    if !int_part.chars().all(|c| c.is_ascii_digit()) || !frac_part.chars().all(|c| c.is_ascii_digit()) {
        bail!("Некорректное число");
    }
    let int: i64 = if int_part.is_empty() {
        0
    } else {
        int_part.parse().map_err(|_| anyhow!("Слишком большое число"))?
    };
    let mut frac = frac_part[..frac_part.len().min(6)].to_string();
    let round_up = frac_part.len() > 6 && frac_part.as_bytes()[6] >= b'5';
    while frac.len() < 6 {
        frac.push('0');
    }
    let mut f: i64 = frac.parse().map_err(|_| anyhow!("Некорректное число"))?;
    if round_up {
        f += 1;
    }
    int.checked_mul(SCALE)
        .and_then(|v| v.checked_add(f))
        .ok_or_else(|| anyhow!("Слишком большое число"))
}

fn tag<'a>(block: &'a str, name: &str) -> Option<&'a str> {
    let open = format!("<{name}>");
    let close = format!("</{name}>");
    let start = block.find(&open)? + open.len();
    let end = block[start..].find(&close)? + start;
    Some(block[start..end].trim())
}

/// Возвращает (код валюты, курс за 1 единицу × 1e6). Номинал (quant) учтён.
pub fn parse_feed(xml: &str) -> Vec<(String, i64)> {
    let mut out = Vec::new();
    for block in xml.split("<item>").skip(1) {
        let block = block.split("</item>").next().unwrap_or(block);
        let (Some(code), Some(desc)) = (tag(block, "title"), tag(block, "description")) else { continue };
        let quant: i64 = tag(block, "quant").and_then(|q| q.parse().ok()).filter(|q| *q > 0).unwrap_or(1);
        let Ok(scaled) = parse_decimal_scaled(desc) else { continue };
        if scaled <= 0 {
            continue;
        }
        out.push((code.to_uppercase(), (scaled + quant / 2) / quant));
    }
    out
}

// ---------------------------------------------------------------- сеть

pub struct DayRates {
    pub source_date: String,
    pub source: &'static str,
    pub rates: Vec<(String, i64)>,
}

async fn fetch_feed(client: &reqwest::Client, date: &NaiveDate) -> Result<Vec<(String, i64)>> {
    let url = format!("https://nationalbank.kz/rss/get_rates.cfm?fdate={}", date.format("%d.%m.%Y"));
    let mut last: Option<anyhow::Error> = None;
    for _ in 0..3 {
        match client.get(&url).send().await {
            Ok(resp) => match resp.error_for_status() {
                Ok(ok) => match ok.text().await {
                    Ok(t) => return Ok(parse_feed(&t)),
                    Err(e) => last = Some(e.into()),
                },
                Err(e) => last = Some(e.into()),
            },
            Err(e) => last = Some(e.into()),
        }
    }
    Err(last.unwrap_or_else(|| anyhow!("Нет ответа от НБРК")))
}

/// Курсы USD/EUR/RUB на дату; если на дату пусто — ближайший предыдущий день (не глубже 10 дней).
/// Ошибка сети возвращается сразу (искать «вчера» при отсутствии связи бессмысленно).
pub async fn fetch_for_date(client: &reqwest::Client, date: &str) -> Result<DayRates> {
    let target = parse_date(date)?;
    let mut d = target;
    for back in 0..=MAX_BACK_DAYS {
        let rates = fetch_feed(client, &d).await?;
        let found: Vec<(String, i64)> = rates.into_iter().filter(|(c, _)| FOREIGN.contains(&c.as_str())).collect();
        if found.len() == FOREIGN.len() {
            return Ok(DayRates {
                source_date: d.format("%Y-%m-%d").to_string(),
                source: if back == 0 { "nbrk" } else { "nbrk_prev" },
                rates: found,
            });
        }
        d = d.checked_sub_signed(Duration::days(1)).ok_or_else(|| anyhow!("Некорректная дата"))?;
    }
    bail!("НБРК не вернул курсы за {date} и {MAX_BACK_DAYS} предыдущих дней")
}

// ---------------------------------------------------------------- кэш в БД

pub fn store(
    conn: &Connection,
    currency: &str,
    resolved_for: &str,
    source_date: &str,
    rate_scaled: i64,
    source: &str,
    needs_recheck: i64,
) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO exchange_rates
           (resolved_for_date, currency, source_date, rate_scaled, quant, source, needs_recheck)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6)",
        params![resolved_for, currency, source_date, rate_scaled, source, needs_recheck],
    )?;
    Ok(())
}

/// Курсы на «сегодня» и будущее считаются временными (needs_recheck = 1).
pub fn store_day(conn: &Connection, resolved_for: &str, day: &DayRates, today: &str) -> Result<()> {
    let recheck = if resolved_for >= today { 1 } else { 0 };
    for (c, rs) in &day.rates {
        store(conn, c, resolved_for, &day.source_date, *rs, day.source, recheck)?;
    }
    Ok(())
}

/// Курс валюты на дату: KZT = 1; точная запись кэша; иначе ближайшая предыдущая (только для показа).
pub fn lookup(conn: &Connection, currency: &str, date: &str) -> Result<Option<Rate>> {
    if currency == "KZT" {
        return Ok(Some(Rate { rate_scaled: SCALE, source_date: date.to_string(), source: "nbrk".into() }));
    }
    let exact: Option<(i64, String, String)> = conn
        .query_row(
            "SELECT rate_scaled, source_date, source FROM exchange_rates WHERE resolved_for_date = ?1 AND currency = ?2",
            params![date, currency],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    if let Some((rate_scaled, source_date, source)) = exact {
        return Ok(Some(Rate { rate_scaled, source_date, source }));
    }
    let prev: Option<(i64, String)> = conn
        .query_row(
            "SELECT rate_scaled, source_date FROM exchange_rates
             WHERE resolved_for_date <= ?1 AND currency = ?2 ORDER BY resolved_for_date DESC LIMIT 1",
            params![date, currency],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    Ok(prev.map(|(rate_scaled, source_date)| Rate { rate_scaled, source_date, source: "cache_prev".into() }))
}

/// Даты, для которых нет полного комплекта курсов или он помечен как временный.
pub fn dates_to_fetch(conn: &Connection, dates: &[String]) -> Result<Vec<String>> {
    let mut out = Vec::new();
    for d in dates {
        validate_date(d)?;
        let n: i64 = conn.query_row(
            "SELECT count(*) FROM exchange_rates
             WHERE resolved_for_date = ?1 AND needs_recheck = 0 AND currency IN ('USD','EUR','RUB')",
            params![d],
            |r| r.get(0),
        )?;
        if n < FOREIGN.len() as i64 {
            out.push(d.clone());
        }
    }
    Ok(out)
}

/// Есть ли вообще счета или операции не в KZT (иначе в сеть ходить незачем).
pub fn foreign_currency_in_use(conn: &Connection) -> Result<bool> {
    let n: i64 = conn.query_row(
        "SELECT (SELECT count(*) FROM balance_lines WHERE currency <> 'KZT')
              + (SELECT count(*) FROM operations WHERE currency <> 'KZT')",
        [],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;

    const SAMPLE: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<rates>
<generator>NBK</generator>
<title>Официальные курсы</title>
<description>Daily</description>
<date>04.11.2026</date>
<item><fullname>ДОЛЛАР США</fullname><title>USD</title><description>480.55</description><quant>1</quant><index>UP</index><change>0.5</change><link/></item>
<item><fullname>ЕВРО</fullname><title>EUR</title><description>556,1</description><quant>1</quant><index>DOWN</index><change>-1.2</change></item>
<item><fullname>РОССИЙСКИЙ РУБЛЬ</fullname><title>RUB</title><description>5.91</description><quant>1</quant></item>
<item><fullname>АРМЯНСКИЙ ДРАМ</fullname><title>AMD</title><description>12.3</description><quant>10</quant></item>
<item><title>BAD</title><description>abc</description><quant>1</quant></item>
</rates>"#;

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrate(&c).unwrap();
        c
    }

    #[test]
    fn decimals() {
        assert_eq!(parse_decimal_scaled("480.55").unwrap(), 480_550_000);
        assert_eq!(parse_decimal_scaled("5,5").unwrap(), 5_500_000);
        assert_eq!(parse_decimal_scaled("0.1234567").unwrap(), 123_457);
        assert_eq!(parse_decimal_scaled("12.").unwrap(), 12_000_000);
        for bad in ["", "abc", "1.2.3", "-5", "1e3"] {
            assert!(parse_decimal_scaled(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn feed_parsing_with_quant() {
        let r = parse_feed(SAMPLE);
        let get = |c: &str| r.iter().find(|x| x.0 == c).map(|x| x.1);
        assert_eq!(get("USD"), Some(480_550_000));
        assert_eq!(get("EUR"), Some(556_100_000));
        assert_eq!(get("RUB"), Some(5_910_000));
        assert_eq!(get("AMD"), Some(1_230_000)); // 12.3 за 10 единиц -> 1.23 за единицу
        assert_eq!(get("BAD"), None);
    }

    #[test]
    fn cache_lookup_and_fallback() {
        let c = conn();
        assert!(lookup(&c, "KZT", "2026-11-03").unwrap().unwrap().rate_scaled == SCALE);
        assert!(lookup(&c, "USD", "2026-11-03").unwrap().is_none());

        store(&c, "USD", "2026-11-03", "2026-11-03", 480_550_000, "nbrk", 0).unwrap();
        let exact = lookup(&c, "USD", "2026-11-03").unwrap().unwrap();
        assert_eq!((exact.rate_scaled, exact.source.as_str()), (480_550_000, "nbrk"));

        // офлайн-запасной вариант: ближайший предыдущий курс из кэша
        let prev = lookup(&c, "USD", "2026-11-10").unwrap().unwrap();
        assert_eq!(prev.source, "cache_prev");
        assert_eq!(prev.source_date, "2026-11-03");
        assert_eq!(gap_days("2026-11-10", &prev.source_date), 7);
        assert!(lookup(&c, "USD", "2026-10-01").unwrap().is_none()); // раньше всех записей — курса нет
    }

    #[test]
    fn what_to_fetch() {
        let c = conn();
        let dates = vec!["2026-11-03".to_string(), "2026-11-04".to_string()];
        assert_eq!(dates_to_fetch(&c, &dates).unwrap().len(), 2);

        let day = DayRates {
            source_date: "2026-11-03".into(),
            source: "nbrk",
            rates: vec![("USD".into(), 480_550_000), ("EUR".into(), 556_100_000), ("RUB".into(), 5_910_000)],
        };
        store_day(&c, "2026-11-03", &day, "2026-11-04").unwrap(); // прошлая дата — окончательно
        assert_eq!(dates_to_fetch(&c, &dates).unwrap(), vec!["2026-11-04".to_string()]);

        store_day(&c, "2026-11-04", &day, "2026-11-04").unwrap(); // «сегодня» — временно
        assert_eq!(dates_to_fetch(&c, &dates).unwrap(), vec!["2026-11-04".to_string()]);
        assert!(dates_to_fetch(&c, &["2026-13-01".to_string()]).is_err());
    }

    #[test]
    fn foreign_in_use() {
        let c = conn();
        assert!(!foreign_currency_in_use(&c).unwrap());
        c.execute_batch(
            "INSERT INTO banks(name) VALUES ('B');
             INSERT INTO owners(name) VALUES ('O');
             INSERT INTO balance_lines(owner_id, region, kind, bank_id, name, currency) VALUES (1,'KZ','bank',1,'X','USD');",
        )
        .unwrap();
        assert!(foreign_currency_in_use(&c).unwrap());
    }

    /// Живая проверка формата ответа НБРК: запускается вручную.
    /// cargo test --release --manifest-path src-tauri/Cargo.toml live_nbrk -- --ignored --nocapture
    #[test]
    #[ignore]
    fn live_nbrk() {
        let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(10)).build().unwrap();
        for date in [today(), "2026-10-31".to_string()] {
            let day = tauri::async_runtime::block_on(fetch_for_date(&client, &date)).unwrap();
            println!("запрошено {date}: курсы за {} ({}): {:?}", day.source_date, day.source, day.rates);
            assert_eq!(day.rates.len(), 3);
        }
    }
}
