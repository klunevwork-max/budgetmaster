use tauri::State;

use crate::{commands_rates, report, AppState};

/// Строит отчёт: сначала дозагружает нужные курсы НБРК (если есть сеть), затем считает.
#[tauri::command]
pub async fn build_report(
    state: State<'_, AppState>,
    end: String,
    start: Option<String>,
) -> Result<report::Report, String> {
    let start = start.filter(|s| !s.trim().is_empty());
    let (period, dates) = {
        let g = state.session.lock().unwrap();
        let s = g.as_ref().ok_or_else(|| "Не выполнен вход".to_string())?;
        let p = report::resolve_period(&s.conn, &end, start.as_deref()).map_err(|e| e.to_string())?;
        let d = report::needed_dates(&s.conn, &p).map_err(|e| e.to_string())?;
        (p, d)
    };

    let refresh = commands_rates::ensure_rates(&state, dates).await?;

    let mut rep = {
        let g = state.session.lock().unwrap();
        let s = g.as_ref().ok_or_else(|| "Не выполнен вход".to_string())?;
        report::build(&s.conn, &period).map_err(|e| e.to_string())?
    };
    if refresh.offline {
        rep.warnings.push("Нет связи с НБРК: используются курсы из кэша, если они есть".to_string());
    } else if !refresh.failed.is_empty() {
        rep.warnings.push(format!("Не удалось загрузить курсы за: {}", refresh.failed.join(", ")));
    }
    Ok(rep)
}
