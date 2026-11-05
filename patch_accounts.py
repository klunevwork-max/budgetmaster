import os

# Путь к файлу управления счетами (проверяем наличие)
path = "src/Balances.tsx" # или Workspace.tsx в зависимости от вашей структуры
if not os.path.exists(path):
    # попробуем найти, где у нас выводятся инпуты счетов
    for root, dirs, files in os.walk("src"):
        for file in files:
            if "Balance" in file or "Workspace" in file:
                print(f"Найден подходящий файл: {os.path.join(root, file)}")

