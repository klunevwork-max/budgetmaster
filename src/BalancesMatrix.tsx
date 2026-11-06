import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

type LineDef = {
  line_id: number;
  label: string;
  owner: string;
  region_name: string;
  place: string;
  name: string | null;
  currency: string;
  is_tax: boolean;
};

export function BalancesMatrixTab({ hide: _hide }: { hide: boolean }) {
  const [startDate, setStartDate] = useState("2026-01-01");
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<LineDef[]>([]);
  const [matrixData, setMatrixData] = useState<Record<string, Record<number, { amount: string | null; is_draft: boolean }>>>({});
  const [datesList, setDatesList] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  // Загружаем список всех доступных линий/счетов
  useEffect(() => {
    invoke<LineDef[]>("list_lines")
      .then(setLines)
      .catch((e) => setMsg(String(e)));
  }, []);

  // Генерация списка дат между startDate и endDate (например, с шагом в месяц или по точкам снапшотов)
  const loadMatrix = async () => {
    setLoading(true);
    try {
      // Для примера формируем список дат (можно настроить шаг: ежемесячно или по конкретным датам)
      const start = new Date(startDate);
      const end = new Date(endDate);
      const dates: string[] = [];
      
      let curr = new Date(start.getFullYear(), start.getMonth(), 1);
      while (curr <= end) {
        dates.push(curr.toISOString().slice(0, 10));
        curr.setMonth(curr.getMonth() + 1);
      }
      if (dates.length === 0) dates.push(endDate);
      setDatesList(dates);

      // Запрашиваем данные для каждой даты параллельно
      const newMatrix: Record<string, Record<number, { amount: string | null; is_draft: boolean }>> = {};
      
      for (const d of dates) {
        const res: any = await invoke("current_balances", {
          asOf: d, ownerId: null, region: "", hideZero: false, group: "all"
        });
        newMatrix[d] = {};
        if (res && res.rows) {
          for (const r of res.rows) {
            newMatrix[d][r.line_id] = {
              amount: r.amount,
              is_draft: r.is_draft
            };
          }
        }
      }
      setMatrixData(newMatrix);
    } catch (e) {
      setMsg(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (lines.length > 0) {
      loadMatrix();
    }
  }, [lines, startDate, endDate]);

  return (
    <div style={{ padding: "12px 8px", fontFamily: "inherit" }}>
      {msg && <div style={{ padding: 12, marginBottom: 16, background: "#fee2e2", color: "#b91c1c", borderRadius: 8 }}>{msg}</div>}

      {/* Панель фильтров */}
      <div style={{ 
        background: "#ffffff", 
        border: "1px solid #e5e7eb", 
        borderRadius: 12, 
        padding: "16px 20px", 
        marginBottom: 20, 
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
        display: "flex",
        flexWrap: "wrap",
        gap: 20,
        alignItems: "center"
      }}>
        <div>
          <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Период с</label>
          <input 
            type="date" 
            value={startDate} 
            onChange={(e) => setStartDate(e.target.value)} 
            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #d1d5db", background: "#f9fafb" }}
          />
        </div>

        <div>
          <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Период по</label>
          <input 
            type="date" 
            value={endDate} 
            onChange={(e) => setEndDate(e.target.value)} 
            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #d1d5db", background: "#f9fafb" }}
          />
        </div>

        <div style={{ paddingTop: 18 }}>
          <button 
            onClick={loadMatrix}
            style={{ background: "#2563eb", color: "#fff", border: "none", padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontWeight: 500 }}
          >
            {loading ? "Загрузка..." : "Обновить матрицу"}
          </button>
        </div>
      </div>

      {/* Таблица-матрица */}
      <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.05)", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #e5e7eb", background: "#fdfdfd" }}>
          <h3 style={{ margin: 0, fontSize: 16, color: "#111827" }}>Матрица динамики счетов (Эксперимент)</h3>
        </div>
        <div style={{ overflowX: "auto", maxHeight: "70vh" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 13, whiteSpace: "nowrap" }}>
            <thead>
              <tr style={{ background: "#f9fafb", color: "#4b5563", borderBottom: "2px solid #e5e7eb", position: "sticky", top: 0, zIndex: 10 }}>
                <th style={{ padding: "12px 16px", position: "sticky", left: 0, background: "#f9fafb", zIndex: 11, borderRight: "1px solid #e5e7eb" }}>Счет / Актив</th>
                <th style={{ padding: "12px 16px" }}>Регион / Валюта</th>
                {datesList.map((d) => (
                  <th key={d} style={{ padding: "12px 16px", textAlign: "right", borderLeft: "1px solid #f3f4f6" }}>{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.line_id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "10px 16px", position: "sticky", left: 0, background: "#fff", zIndex: 5, borderRight: "1px solid #e5e7eb", fontWeight: 500 }}>
                    {l.owner} · {l.place} {l.name ? `(${l.name})` : ""}
                  </td>
                  <td style={{ padding: "10px 16px", color: "#6b7280" }}>
                    {l.region_name} · <span style={{ background: "#e5e7eb", padding: "2px 5px", borderRadius: 4, fontSize: 11 }}>{l.currency}</span>
                  </td>
                  {datesList.map((d) => {
                    const cellInfo = matrixData[d]?.[l.line_id];
                    const isDraft = cellInfo?.is_draft;
                    return (
                      <td 
                        key={d} 
                        style={{ 
                          padding: "10px 16px", 
                          textAlign: "right", 
                          borderLeft: "1px solid #f3f4f6", 
                          background: isDraft ? "#fffbeb" : undefined,
                          fontWeight: cellInfo?.amount ? 600 : 400,
                          color: cellInfo?.amount ? "#111827" : "#9ca3af"
                        }}
                        title={isDraft ? "Черновик" : undefined}
                      >
                        {cellInfo?.amount ?? "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
