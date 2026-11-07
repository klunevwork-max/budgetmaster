import re

with open("src-tauri/src/data.rs", "r", encoding="utf-8") as f:
    content = f.read()

# Проверим и заменим структуру Line, если нужно, или обновим list_lines
# Давайте найдем определение Line и заменим его и list_lines на полную поддержку полей депозита.

# Сначала убедимся, что структуры Line имеют поля депозита
old_line_struct = """pub struct Line {"""

# Обновим list_lines запрос, чтобы он выбирал deposit_start_date, deposit_end_date, deposit_payout_mode
# Посмотрим, как устроен list_lines в data.rs
