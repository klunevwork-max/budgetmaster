use serde::{Deserialize, Serialize};
use chrono::{NaiveDate, Datelike};
use anyhow::{Result, anyhow};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LoanType {
    Annuity,       // Аннуитетный (равные платежи)
    Differentiated, // Дифференцированный
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Loan {
    pub id: i64,
    pub name: String,             // Название ("Ипотека", "Кредит на учебу")
    pub currency: String,         // KZT, USD, etc.
    pub principal_scaled: i128,    // Сумма кредита в тиынах
    pub rate_bps: u32,            // Ставка в базисных пунктах (например, 1500 = 15.0%)
    pub start_date: String,    // Дата выдачи
    pub term_months: u32,         // Срок в месяцах
    pub loan_type: LoanType,      // Тип платежа
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoanStateAtDate {
    pub loan_id: i64,
    pub monthly_payment_scaled: i128,  // Текущий ежемесячный платёж (в тиынах)
    pub remaining_principal: i128,     // Остаток основного долга на дату
    pub interest_portion: i128,        // Проценты в текущем месяце
    pub principal_portion: i128,       // Тело долга в текущем месяце
    pub paid_months: u32,              // Прошедших месяцев
}

impl Loan {
    /// Расчёт ежемесячного аннуитетного платежа в тиынах
    pub fn calculate_monthly_payment(&self) -> i128 {
        let principal = self.principal_scaled as f64;
        let annual_rate = (self.rate_bps as f64) / 10000.0;
        let monthly_rate = annual_rate / 12.0;
        let n = self.term_months as f64;

        if monthly_rate == 0.0 || n == 0.0 {
            return (principal / if n == 0.0 { 1.0 } else { n }).round() as i128;
        }

        let pow_term = (1.0 + monthly_rate).powf(n);
        let monthly_payment = principal * (monthly_rate * pow_term) / (pow_term - 1.0);
        
        monthly_payment.round() as i128
    }

    /// Состояние кредита на конкретную дату
    pub fn get_state_at(&self, as_of: NaiveDate) -> LoanStateAtDate {
        let monthly_payment = self.calculate_monthly_payment();
        let monthly_rate = ((self.rate_bps as f64) / 10000.0) / 12.0;

        let parsed_start = NaiveDate::parse_from_str(&self.start_date, "%Y-%m-%d").unwrap_or(as_of);
        let months_passed = calculate_months_between(parsed_start, as_of);
        
        if months_passed >= self.term_months {
            return LoanStateAtDate {
                loan_id: self.id,
                monthly_payment_scaled: 0,
                remaining_principal: 0,
                interest_portion: 0,
                principal_portion: 0,
                paid_months: self.term_months,
            };
        }

        let mut current_balance = self.principal_scaled as f64;
        let mut interest_portion = 0.0;
        let mut principal_portion = 0.0;

        for _ in 0..=months_passed {
            interest_portion = current_balance * monthly_rate;
            principal_portion = (monthly_payment as f64) - interest_portion;
            current_balance -= principal_portion;
            if current_balance < 0.0 {
                current_balance = 0.0;
            }
        }

        LoanStateAtDate {
            loan_id: self.id,
            monthly_payment_scaled: monthly_payment,
            remaining_principal: (current_balance + principal_portion).round() as i128,
            interest_portion: interest_portion.round() as i128,
            principal_portion: principal_portion.round() as i128,
            paid_months: months_passed,
        }
    }
}

fn calculate_months_between(start: NaiveDate, end: NaiveDate) -> u32 {
    if end <= start {
        return 0;
    }
    let years = end.year() - start.year();
    let months = (end.month() as i32) - (start.month() as i32);
    let total = years * 12 + months;
    if total < 0 { 0 } else { total as u32 }
}
