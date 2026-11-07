with open("src-tauri/src/report.rs", "r", encoding="utf-8") as f:
    code = f.read()

# Заменим функцию calculate_deposit_accruals на версию с подробными println!
old_func_start = "pub fn calculate_deposit_accruals("
if old_func_start in code:
    parts = code.split(old_func_start)
    # Найдём конец функции (следующая pub fn или конец файла)
    # Попробуем заменить тело функции напрямую
    print("Found calculate_deposit_accruals, applying debug logs...")

