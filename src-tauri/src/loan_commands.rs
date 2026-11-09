use tauri::command;
use chrono::NaiveDate; // handled via string or NaiveDate
use crate::loan::{Loan, LoanStateAtDate, LoanType};

// Временное хранилище в памяти или интеграция с вашей БД
#[command]
pub async fn get_loans() -> Result<Vec<Loan>, String> {
    // Здесь будет загрузка из базы данных. Для примера вернем дефолтный тестовый кредит (Ипотека)
    Ok(vec![
        Loan {
            id: 1,
            name: "Ипотека на квартиру".to_string(),
            currency: "KZT".to_string(),
            principal_scaled: 3500000000, // 35 млн тенге в тиынах
            rate_bps: 1450,               // 14.5%
            start_date: chrono::NaiveDate::from_ymd_opt(2025, 1, 1).unwrap().to_string(),
            term_months: 240,             // 20 лет
            loan_type: LoanType::Annuity,
        }
    ])
}

#[command]
pub async fn get_loan_states(as_of: String) -> Result<Vec<LoanStateAtDate>, String> {
    let date = chrono::NaiveDate::parse_from_str(&as_of, "%Y-%m-%d")
        .unwrap_or_else(|_| chrono::Utc::now().naive_utc().date());
    
    let loans = get_loans().await?;
    let states = loans.iter().map(|l| l.get_state_at(date)).collect();
    Ok(states)
}


#[command]
pub async fn add_loan(
    name: String,
    currency: String,
    principal_scaled: i128,
    rate_bps: u32,
    start_date: String,
    term_months: u32,
    loan_type: String,
) -> Result<(), String> {
    let parsed_date = chrono::NaiveDate::parse_from_str(&start_date, "%Y-%m-%d")
        .map_err(|e| format!("Invalid date format: {}", e))?;
    
    let l_type = match loan_type.as_str() {
        "Differentiated" => LoanType::Differentiated,
        _ => LoanType::Annuity,
    };

    // Здесь в будущем будет запись в вашу БД, пока логируем/добавляем
    println!("Adding loan: {} with principal {}", name, principal_scaled);
    Ok(())
}
