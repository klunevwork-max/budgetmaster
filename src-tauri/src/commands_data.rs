use rusqlite::Connection;
use tauri::State;

use crate::{data, money, AppState};

fn with_conn<T>(
    state: &State<'_, AppState>,
    f: impl FnOnce(&Connection) -> anyhow::Result<T>,
) -> Result<T, String> {
    let g = state.session.lock().unwrap();
    let s = g.as_ref().ok_or_else(|| "Не выполнен вход".to_string())?;
    f(&s.conn).map_err(|e| e.to_string())
}

fn opt(s: Option<String>) -> Option<String> {
    s.filter(|x| !x.trim().is_empty())
}

#[tauri::command]
pub async fn list_snapshots(state: State<'_, AppState>) -> Result<Vec<data::Snapshot>, String> {
    with_conn(&state, |c| data::list_snapshots(c))
}

#[tauri::command]
pub async fn add_snapshot(state: State<'_, AppState>, date: String, currency: String, amount: String) -> Result<i64, String> {
    with_conn(&state, |c| data::add_snapshot(c, &date, &currency, money::parse_amount(&amount)?))
}

#[tauri::command]
pub async fn update_snapshot(state: State<'_, AppState>, id: i64, date: String, currency: String, amount: String) -> Result<(), String> {
    with_conn(&state, |c| data::update_snapshot(c, id, &date, &currency, money::parse_amount(&amount)?))
}

#[tauri::command]
pub async fn delete_snapshot(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    with_conn(&state, |c| data::delete_snapshot(c, id))
}

#[tauri::command]
pub async fn list_categories(state: State<'_, AppState>) -> Result<Vec<data::Category>, String> {
    with_conn(&state, |c| data::list_categories(c))
}

#[tauri::command]
pub async fn add_category(state: State<'_, AppState>, name: String, cat_type: String, is_interest: bool) -> Result<i64, String> {
    with_conn(&state, |c| data::add_category(c, &name, &cat_type, is_interest))
}

#[tauri::command]
pub async fn update_category(state: State<'_, AppState>, id: i64, name: String, cat_type: String, is_interest: bool) -> Result<(), String> {
    with_conn(&state, |c| data::update_category(c, id, &name, &cat_type, is_interest))
}

#[tauri::command]
pub async fn delete_category(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    with_conn(&state, |c| data::delete_category(c, id))
}

#[tauri::command]
pub async fn list_operations(
    state: State<'_, AppState>,
    date_from: Option<String>,
    date_to: Option<String>,
    op_type: Option<String>,
    category_id: Option<i64>,
) -> Result<Vec<data::Operation>, String> {
    let (from, to, kind) = (opt(date_from), opt(date_to), opt(op_type));
    with_conn(&state, |c| data::list_operations(c, from.as_deref(), to.as_deref(), kind.as_deref(), category_id))
}

#[tauri::command]
pub async fn add_operation(
    state: State<'_, AppState>,
    date: String,
    op_type: String,
    currency: String,
    amount: String,
    category_id: Option<i64>,
    comment: Option<String>,
) -> Result<i64, String> {
    with_conn(&state, |c| {
        data::add_operation(c, &date, &op_type, &currency, money::parse_amount(&amount)?, category_id, comment.as_deref())
    })
}

#[tauri::command]
pub async fn update_operation(
    state: State<'_, AppState>,
    id: i64,
    date: String,
    op_type: String,
    currency: String,
    amount: String,
    category_id: Option<i64>,
    comment: Option<String>,
) -> Result<(), String> {
    with_conn(&state, |c| {
        data::update_operation(c, id, &date, &op_type, &currency, money::parse_amount(&amount)?, category_id, comment.as_deref())
    })
}

#[tauri::command]
pub async fn delete_operation(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    with_conn(&state, |c| data::delete_operation(c, id))
}
