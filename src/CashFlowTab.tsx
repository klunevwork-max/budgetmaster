import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface LoanState {
  loan_id: number;
  monthly_payment_scaled: number;
  remaining_principal: number;
  interest_portion: number;
  principal_portion: number;
}

export function CashFlowTab() {
  const [loanStates, setLoanStates] = useState<LoanState[]>([]);
  
  // Тестовые или загружаемые данные активных / пассивных доходов и расходов
  const salary = 750000; // Активный доход
  const livingExpenses = 250000; // Бытовые расходы
  const educationExpenses = 60000; // Оплата учебы

  useEffect(() => {
    // Загружаем состояние кредитов на текущую дату
    const today = new Date().toISOString().split("T")[0];
    invoke<LoanState[]>("get_loan_states", { as_of: today })
      .then(setLoanStates)
      .catch(console.error);
  }, []);

  // Суммарный ежемесячный платеж по кредитам/ипотеке
  const totalLoanPayments = loanStates.reduce(
    (acc, s) => acc + s.monthly_payment_scaled / 100, 
    0
  );

  const totalIncome = salary; // + пассивные от депозитов
  const totalExpense = livingExpenses + educationExpenses + totalLoanPayments;
  const netCashFlow = totalIncome - totalExpense;

  return (
    <div style={{ padding: "24px", color: "#e5e7eb", fontFamily: "sans-serif" }}>
      <h2 style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "20px" }}>
        📊 Денежный поток (Cash Flow)
      </h2>

      {/* Верхняя сводная плашка */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "24px" }}>
        <div style={{ background: "#1f2937", padding: "16px", borderRadius: "8px" }}>
          <div style={{ fontSize: "14px", color: "#9ca3af" }}>Общий приход</div>
          <div style={{ fontSize: "22px", fontWeight: "bold", color: "#16a34a" }}>{totalIncome.toLocaleString()} ₸</div>
        </div>
        <div style={{ background: "#1f2937", padding: "16px", borderRadius: "8px" }}>
          <div style={{ fontSize: "14px", color: "#9ca3af" }}>Общий расход</div>
          <div style={{ fontSize: "22px", fontWeight: "bold", color: "#dc2626" }}>{totalExpense.toLocaleString()} ₸</div>
        </div>
        <div style={{ background: "#1f2937", padding: "16px", borderRadius: "8px" }}>
          <div style={{ fontSize: "14px", color: "#9ca3af" }}>Чистый поток</div>
          <div style={{ fontSize: "22px", fontWeight: "bold", color: netCashFlow >= 0 ? "#16a34a" : "#dc2626" }}>
            {netCashFlow.toLocaleString()} ₸
          </div>
        </div>
      </div>

      {/* Две колонки: Доходы / Расходы */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
        {/* Левая колонка: Доходы */}
        <div style={{ background: "#111827", padding: "20px", borderRadius: "12px", border: "1px solid #374151" }}>
          <h3 style={{ fontSize: "18px", color: "#16a34a", marginBottom: "16px" }}>🟢 Доходы (Income)</h3>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
            <span>Основная зарплата</span>
            <span>{salary.toLocaleString()} ₸</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px", color: "#9ca3af" }}>
            <span>Пассивный доход (депозиты)</span>
            <span>Авто-расчет</span>
          </div>
        </div>

        {/* Правая колонка: Расходы */}
        <div style={{ background: "#111827", padding: "20px", borderRadius: "12px", border: "1px solid #374151" }}>
          <h3 style={{ fontSize: "18px", color: "#dc2626", marginBottom: "16px" }}>🔴 Расходы и обязательства</h3>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
            <span>Жизненные расходы</span>
            <span>{livingExpenses.toLocaleString()} ₸</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
            <span>Оплата учебы</span>
            <span>{educationExpenses.toLocaleString()} ₸</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px", borderTop: "1px solid #374151", paddingTop: "12px" }}>
            <span>Платежи по кредитам / ипотеке</span>
            <span style={{ color: "#f87171" }}>{totalLoanPayments.toLocaleString()} ₸</span>
          </div>
        </div>
      </div>
    </div>
  );
}
