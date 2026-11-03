use anyhow::{anyhow, bail, Result};

/// Предел суммы: 10^13 основных единиц (10^15 минорных).
pub const MAX_MINOR: i64 = 1_000_000_000_000_000;

/// "1234.56", "1 234,56", "-100", "0,5" -> минорные единицы (тиын/центы).
pub fn parse_amount(input: &str) -> Result<i64> {
    let s: String = input
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '\u{a0}')
        .collect::<String>()
        .replace(',', ".");
    if s.is_empty() {
        bail!("Введите сумму");
    }
    let (neg, digits) = match s.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, s.strip_prefix('+').unwrap_or(&s)),
    };
    let mut parts = digits.split('.');
    let int_part = parts.next().unwrap_or("");
    let frac_part = parts.next().unwrap_or("");
    if parts.next().is_some() {
        bail!("Некорректная сумма: используйте одну десятичную точку или запятую");
    }
    if int_part.is_empty() && frac_part.is_empty() {
        bail!("Некорректная сумма");
    }
    if !int_part.chars().all(|c| c.is_ascii_digit()) || !frac_part.chars().all(|c| c.is_ascii_digit()) {
        bail!("Некорректная сумма: допустимы только цифры, точка или запятая");
    }
    if frac_part.len() > 2 {
        bail!("Не более 2 знаков после запятой");
    }
    let int: i64 = if int_part.is_empty() {
        0
    } else {
        int_part.parse().map_err(|_| anyhow!("Слишком большая сумма"))?
    };
    let mut frac_s = frac_part.to_string();
    while frac_s.len() < 2 {
        frac_s.push('0');
    }
    let frac: i64 = frac_s.parse().map_err(|_| anyhow!("Некорректная сумма"))?;
    let total = int
        .checked_mul(100)
        .and_then(|v| v.checked_add(frac))
        .ok_or_else(|| anyhow!("Слишком большая сумма"))?;
    if total > MAX_MINOR {
        bail!("Слишком большая сумма");
    }
    Ok(if neg { -total } else { total })
}

pub fn format_minor(v: i64) -> String {
    let a = v.unsigned_abs();
    format!("{}{}.{:02}", if v < 0 { "-" } else { "" }, a / 100, a % 100)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ok() {
        assert_eq!(parse_amount("1234.56").unwrap(), 123456);
        assert_eq!(parse_amount("1 234,5").unwrap(), 123450);
        assert_eq!(parse_amount("-100").unwrap(), -10000);
        assert_eq!(parse_amount("0,05").unwrap(), 5);
        assert_eq!(parse_amount(".5").unwrap(), 50);
        assert_eq!(parse_amount("+7").unwrap(), 700);
    }

    #[test]
    fn parse_bad() {
        for bad in ["", "abc", "1.234", "1.2.3", "--5", "1e5", "99999999999999999999", "20000000000000"] {
            assert!(parse_amount(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn format() {
        assert_eq!(format_minor(123456), "1234.56");
        assert_eq!(format_minor(-5), "-0.05");
        assert_eq!(format_minor(0), "0.00");
    }
}
