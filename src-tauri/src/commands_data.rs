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

// ---- владельцы
#[tauri::command]
pub async fn list_owners(state: State<'_, AppState>) -> Result<Vec<data::Owner>, String> {
    with_conn(&state, |c| data::list_owners(c))
}

#[tauri::command]
pub async fn add_owner(state: State<'_, AppState>, name: String) -> Result<i64, String> {
    with_conn(&state, |c| data::add_owner(c, &name))
}

#[tauri::command]
pub async fn rename_owner(state: State<'_, AppState>, id: i64, name: String) -> Result<(), String> {
    with_conn(&state, |c| data::rename_owner(c, id, &name))
}

#[tauri::command]
pub async fn delete_owner(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    with_conn(&state, |c| data::delete_owner(c, id))
}

// ---- банки
#[tauri::command]
pub async fn list_banks(state: State<'_, AppState>) -> Result<Vec<data::Bank>, String> {
    with_conn(&state, |c| data::list_banks(c))
}

#[tauri::command]
pub async fn add_bank(state: State<'_, AppState>, name: String) -> Result<i64, String> {
    with_conn(&state, |c| data::add_bank(c, &name))
}

#[tauri::command]
pub async fn rename_bank(state: State<'_, AppState>, id: i64, name: String) -> Result<(), String> {
    with_conn(&state, |c| data::rename_bank(c, id, &name))
}

#[tauri::command]
pub async fn delete_bank(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    with_conn(&state, |c| data::delete_bank(c, id))
}

// ---- счета
#[tauri::command]
pub async fn list_lines(state: State<'_, AppState>) -> Result<Vec<data::Line>, String> {
    with_conn(&state, |c| data::list_lines(c))
}

#[tauri::command]
pub async fn add_line(
    state: State<'_, AppState>,
    owner_id: i64,
    region: String,
    kind: String,
    bank_id: Option<i64>,
    name: String,
    currency: String,
) -> Result<i64, String> {
    with_conn(&state, |c| data::add_line(c, owner_id, &region, &kind, bank_id, &name, &currency))
}

#[tauri::command]
pub async fn update_line(
    state: State<'_, AppState>,
    id: i64,
    owner_id: i64,
    region: String,
    bank_id: Option<i64>,
    name: String,
) -> Result<(), String> {
    with_conn(&state, |c| data::update_line(c, id, owner_id, &region, bank_id, &name))
}

#[tauri::command]
pub async fn delete_line(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    with_conn(&state, |c| data::delete_line(c, id))
}

// ---- позиции баланса и актуальные остатки
#[tauri::command]
pub async fn list_snapshots(state: State<'_, AppState>) -> Result<Vec<data::Snapshot>, String> {
    with_conn(&state, |c| data::list_snapshots(c))
}

#[tauri::command]
pub async fn add_snapshot(state: State<'_, AppState>, line_id: i64, date: String, amount: String) -> Result<i64, String> {
    with_conn(&state, |c| data::add_snapshot(c, line_id, &date, money::parse_amount(&amount)?))
}

#[tauri::command]
pub async fn update_snapshot(state: State<'_, AppState>, id: i64, line_id: i64, date: String, amount: String) -> Result<(), String> {
    with_conn(&state, |c| data::update_snapshot(c, id, line_id, &date, money::parse_amount(&amount)?))
}

#[tauri::command]
pub async fn delete_snapshot(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    with_conn(&state, |c| data::delete_snapshot(c, id))
}

#[tauri::command]
pub async fn current_balances(
    state: State<'_, AppState>,
    as_of: String,
    owner_id: Option<i64>,
    region: Option<String>,
    hide_zero: bool,
    group: String,
) -> Result<data::Balances, String> {
    let region = opt(region);
    with_conn(&state, |c| data::current_balances(c, &as_of, owner_id, region.as_deref(), hide_zero, &group))
}

// ---- категории
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

// ---- операции
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

// ---- перенос остатков (черновики)
#[tauri::command]
pub async fn copy_balances(state: State<'_, AppState>, date: String) -> Result<data::CopyResult, String> {
    with_conn(&state, |c| data::copy_balances_to_date(c, &date))
}

#[tauri::command]
pub async fn confirm_snapshot(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    with_conn(&state, |c| data::confirm_snapshot(c, id))
}

#[tauri::command]
pub async fn confirm_drafts(state: State<'_, AppState>, date: String) -> Result<usize, String> {
    with_conn(&state, |c| data::confirm_drafts(c, &date))
}

#[tauri::command]
pub async fn discard_drafts(state: State<'_, AppState>, date: String) -> Result<usize, String> {
    with_conn(&state, |c| data::discard_drafts(c, &date))
}
