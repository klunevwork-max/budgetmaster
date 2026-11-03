use anyhow::{anyhow, bail, Result};
use chrono::{Datelike, NaiveDate};

/// Строго YYYY-MM-DD, реальная дата, год 1900..=2200.
pub fn validate_date(s: &str) -> Result<()> {
    if s.len() != 10 || !s.is_ascii() {
        bail!("Некорректная дата (нужен формат ГГГГ-ММ-ДД)");
    }
    let d = NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|_| anyhow!("Некорректная дата"))?;
    if d.format("%Y-%m-%d").to_string() != s || !(1900..=2200).contains(&d.year()) {
        bail!("Некорректная дата");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates() {
        assert!(validate_date("2026-11-03").is_ok());
        assert!(validate_date("2024-02-29").is_ok());
        for bad in ["2026-13-45", "2025-02-29", "2026-1-05", "26-11-03", "", "2026/11/03", "1800-01-01", "2026-11-3x"] {
            assert!(validate_date(bad).is_err(), "{bad}");
        }
    }
}
