use serde::Serialize;
use std::time::Duration;
use tauri::State;

use crate::{dates, rates, AppState};

#[derive(Serialize)]
pub struct RefreshReport {
    pub requested: usize,
    pub fetched: usize,
    pub failed: Vec<String>,
    pub offline: bool,
    pub skipped: bool,
}

/// Дозагружает курсы НБРК на указанные даты (только если нужны и не закэшированы).
/// Ошибка по одной дате не ломает остальные.
#[tauri::command]
pub async fn refresh_rates(state: State<'_, AppState>, dates: Vec<String>) -> Result<RefreshReport, String> {
    ensure_rates(&state, dates).await
}

pub async fn ensure_rates(state: &State<'_, AppState>, dates: Vec<String>) -> Result<RefreshReport, String> {
    let mut uniq = dates;
    uniq.sort();
    uniq.dedup();
    if uniq.len() > 400 {
        return Err("Слишком много дат".into());
    }
    for d in &uniq {
        dates::validate_date(d).map_err(|e| e.to_string())?;
    }

    let (todo, needed) = {
        let g = state.session.lock().unwrap();
        let s = g.as_ref().ok_or_else(|| "Не выполнен вход".to_string())?;
        let needed = rates::foreign_currency_in_use(&s.conn).map_err(|e| e.to_string())?;
        let todo = if needed { rates::dates_to_fetch(&s.conn, &uniq).map_err(|e| e.to_string())? } else { vec![] };
        (todo, needed)
    };

    if todo.is_empty() {
        return Ok(RefreshReport { requested: uniq.len(), fetched: 0, failed: vec![], offline: false, skipped: !needed });
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("BudgetMaster/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    let today = rates::today();

    let mut fetched = 0usize;
    let mut failed: Vec<String> = Vec::new();
    for d in todo {
        match rates::fetch_for_date(&client, &d).await {
            Ok(day) => {
                let g = state.session.lock().unwrap();
                if let Some(s) = g.as_ref() {
                    rates::store_day(&s.conn, &d, &day, &today).map_err(|e| e.to_string())?;
                    fetched += 1;
                }
            }
            Err(_) => failed.push(d),
        }
    }
    let offline = fetched == 0 && !failed.is_empty();
    Ok(RefreshReport { requested: uniq.len(), fetched, failed, offline, skipped: false })
}
