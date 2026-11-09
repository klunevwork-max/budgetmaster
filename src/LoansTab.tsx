import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Loan {
  id: number;
  name: string;
  currency: string;
  principal_scaled: number;
  rate_bps: number;
  start_date: string;
  term_months: number;
  loan_type: string;
}

interface LoanState {
  loan_id: number;
  monthly_payment_scaled: number;
  remaining_principal: number;
  interest_portion: number;
  principal_portion: number;
  paid_months: number;
}

export function LoansTab() {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [states, setStates] = useState<Record<number, LoanState>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const today = new Date().toISOString().split("T")[0];
    Promise.all([
      invoke<Loan[]>("get_loans"),
      invoke<LoanState[]>("get_loan_states", { as_of: today })
    ])
      .then(([loansData, statesData]) => {
        setLoans(loansData);
        const statesMap: Record<number, LoanState> = {};
        statesData.forEach(s => {
          statesMap[s.loan_id] = s;
        });
        setStates(statesMap);
        setLoading(false);
      })
      .catch(err => {
        console.error("Failed to load loans:", err);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div style={{ padding: "24px", color: "#9ca3af" }}>Загрузка кредитов...</div>;
  }

  return (
    <div style={{ padding: "24px", color: "#e5e7eb", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <h2 style={{ fontSize: "24px", fontWeight: "bold" }}>🏦 Кредиты и ипотека</h2>
      </div>

      <div style={{ display: "grid", gap: "20px" }}>
        {loans.map(loan => {
          const state = states[loan.id];
          const principalKZT = loan.principal_scaled / 100;
          const remainingKZT = state ? state.remaining_principal / 100 : principalKZT;
          const monthlyPaymentKZT = state ? state.monthly_payment_scaled / 100 : 0;
          const interestKZT = state ? state.interest_portion / 100 : 0;
          const bodyKZT = state ? state.principal_portion / 100 : 0;
          const ratePercent = loan.rate_bps / 100;

          return (
            <div key={loan.id} style={{ background: "#111827", border: "1px solid #374151", borderRadius: "12px", padding: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
                <div>
                  <h3 style={{ fontSize: "18px", fontWeight: "bold", color: "#f3f4f6", margin: "0 0 4px 0" }}>
                    {loan.name}
                  </h3>
                  <span style={{ fontSize: "13px", color: "#9ca3af" }}>
                    Старт: {loan.start_date} • Срок: {loan.term_months} мес. • Ставка: {ratePercent}% годовых
                  </span>
                </div>
                <div style={{ background: "#1f2937", padding: "6px 12px", borderRadius: "6px", fontSize: "14px", color: "#60a5fa" }}>
                  {loan.currency}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", background: "#1f2937", padding: "16px", borderRadius: "8px" }}>
                <div>
                  <div style={{ fontSize: "12px", color: "#9ca3af", marginBottom: "4px" }}>Первоначальный долг</div>
                  <div style={{ fontSize: "16px", fontWeight: "bold" }}>{principalKZT.toLocaleString()} ₸</div>
                </div>
                <div>
                  <div style={{ fontSize: "12px", color: "#9ca3af", marginBottom: "4px" }}>Остаток долга</div>
                  <div style={{ fontSize: "16px", fontWeight: "bold", color: "#f87171" }}>{remainingKZT.toLocaleString()} ₸</div>
                </div>
                <div>
                  <div style={{ fontSize: "12px", color: "#9ca3af", marginBottom: "4px" }}>Ежемесячный платёж</div>
                  <div style={{ fontSize: "16px", fontWeight: "bold", color: "#fbbf24" }}>{monthlyPaymentKZT.toLocaleString()} ₸</div>
                </div>
                <div>
                  <div style={{ fontSize: "12px", color: "#9ca3af", marginBottom: "4px" }}>Тело / Проценты в мес.</div>
                  <div style={{ fontSize: "14px", color: "#34d399" }}>
                    Т: {bodyKZT.toLocaleString()} ₸<br/>
                    П: {interestKZT.toLocaleString()} ₸
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
