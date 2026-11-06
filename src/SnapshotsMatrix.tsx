import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DRAFT_BG } from "./ui";

type Line = {
  id: number;
  owner: string;
  region: string;
  region_name: string;
  bank_name: string | null;
  place: string;
  name: string | null;
  currency: string;
  is_tax: boolean;
};

type Snapshot = {
  id: number;
  line_id: number;
  line_label: string;
  date: string;
  currency: string;
  amount: string;
  is_draft: boolean;
};

type CopyResult = { created: number; skipped_existing: number; skipped_closed: number; skipped_empty: number };

const todayStr = () => new Date().toISOString().slice(0, 10);

export function SnapshotsMatrixTab({ hide }: { hide: boolean }) {
  if (hide) return null;

  const [lines, setLines] = useState<Line[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  
  // Фильтр периода дат и чекбокс скрытия нулевых строк
  const [startDate, setStartDate] = useState("2026-01-01");
  const [endDate, setEndDate] = useState(todayStr());
  const [hideZeros, setHideZeros] = useState(true);

  // Редактируемая ячейка
  const [editingCell, setEditingCell] = useState<{ lineId: number; date: string } | null>(null);
  const [editValue, setEditValue] = useState("");

  const [copyDate, setCopyDate] = useState(todayStr());
  const [info, setInfo] = useState("");
  const [msg, setMsg] = useState("");

  const loadData = useCallback(async () => {
    try {
      const l = await invoke<Line[]>("list_lines");
      const s = await invoke<Snapshot[]>("list_snapshots");
      setLines(l);
      setSnapshots(s);
    } catch (e) {
      setMsg(String(e));
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Все уникальные даты из снапшотов
  const allRawDates = Array.from(new Set(snapshots.map((s) => s.date))).sort();
  
  const datesList = allRawDates.filter((d) => {
    if (startDate && d < startDate) return false;
    if (endDate && d > endDate) return false;
    return true;
  });

  const effectiveDates = datesList.length > 0 ? datesList : (allRawDates.length > 0 ? allRawDates : [todayStr()]);

  // Карта прямых снапшотов: "lineId_date" -> Snapshot
  const directMap = new Map<string, Snapshot>();
  for (const s of snapshots) {
    directMap.set(`${s.line_id}_${s.date}`, s);
  }

  const getResolvedCell = (lineId: number, targetDate: string) => {
    const relevantDates = allRawDates.filter((d) => d <= targetDate);
    for (let i = relevantDates.length - 1; i >= 0; i--) {
      const d = relevantDates[i];
      const found = directMap.get(`${lineId}_${d}`);
      if (found) {
        const isReal = d === targetDate;
        return {
          amount: found.amount,
          is_draft: found.is_draft,
          isReal,
        };
      }
    }
    return null;
  };

  async function handleSaveCell(lineId: number, date: string, val: string) {
    setMsg("");
    try {
      const existing = directMap.get(`${lineId}_${date}`);
      if (val.trim() === "") {
        if (existing) {
          await invoke("delete_snapshot", { id: existing.id });
        }
      } else {
        if (existing) {
          await invoke("update_snapshot", { id: existing.id, lineId, date, amount: val });
        } else {
          await invoke("add_snapshot", { lineId, date, amount: val });
        }
      }
      setEditingCell(null);
      await loadData();
    } catch (e) {
      setMsg(String(e));
    }
  }

  async function handleCopyBalances() {
    setMsg("");
    setInfo("");
    try {
      const r = await invoke<CopyResult>("copy_balances", { date: copyDate });
      setInfo(
        `Создано черновиков на ${copyDate}: ${r.created}. Пропущено: уже есть — ${r.skipped_existing}, закрытые — ${r.skipped_closed}, без истории — ${r.skipped_empty}.`
      );
      await loadData();
    } catch (e) {
      setMsg(String(e));
    }
  }

  // Фильтрация строк: если включен hideZeros, скрываем счета, у которых за ВСЕ видимые даты баланс = 0 или отсутствует
  const visibleLines = lines.filter((l) => {
    if (!hideZeros) return true;
    // Проверяем, есть ли хоть в одной эффективной дате ненулевой баланс
    let hasNonZero = false;
    for (const d of effectiveDates) {
      const res = getResolvedCell(l.id, d);
      if (res && res.amount !== null) {
        const cleanVal = res.amount.replace(/\s/g, "").replace(",", ".");
        const num = parseFloat(cleanVal);
        if (!isNaN(num) && num !== 0) {
          hasNonZero = true;
          break;
        }
      }
    }
    return hasNonZero;
  });

  return (
    <div style={{ padding: "8px 4px", fontFamily: "inherit" }}>
      {msg && <div style={{ padding: 12, marginBottom: 16, background: "#fee2e2", color: "#b91c1c", borderRadius: 8 }}>{msg}</div>}

      {/* Панель управления */}
      <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "16px 20px", marginBottom: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.05)", display: "flex", flexWrap: "wrap", gap: 24, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Период с</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #d1d5db", background: "#f9fafb" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 4 }}>по</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #d1d5db", background: "#f9fafb" }} />
          </div>
        </div>

        <div style={{ borderLeft: "1px solid #e5e7eb", paddingLeft: 24, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Скопировать балансы на дату</label>
            <input type="date" value={copyDate} onChange={(e) => setCopyDate(e.target.value)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #d1d5db", background: "#f9fafb" }} />
          </div>
          <div style={{ paddingTop: 18 }}>
            <button onClick={handleCopyBalances} style={{ background: "#2563eb", color: "#fff", border: "none", padding: "7px 14px", borderRadius: 6, cursor: "pointer", fontWeight: 500 }}>
              Скопировать балансы
            </button>
          </div>
        </div>

        <div style={{ borderLeft: "1px solid #e5e7eb", paddingLeft: 24, paddingTop: 18 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, fontWeight: 500, color: "#374151" }}>
            <input type="checkbox" checked={hideZeros} onChange={(e) => setHideZeros(e.target.checked)} style={{ width: 16, height: 16 }} />
            Скрывать нулевые строки
          </label>
        </div>
      </div>

      {info && <div style={{ padding: "10px 14px", marginBottom: 16, background: "#eff6ff", color: "#1e40af", borderRadius: 8, fontSize: 14 }}>{info}</div>}

      {/* Таблица */}
      <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.05)", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #e5e7eb", background: "#fdfdfd", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: 16, color: "#111827" }}>Матрица динамики позиций</h3>
          <span style={{ fontSize: 13, color: "#6b7280" }}>Нажмите на иконку карандаша в ячейке для редактирования</span>
        </div>

        <div style={{ overflowX: "auto", maxHeight: "70vh" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 13, whiteSpace: "nowrap" }}>
            <thead>
              <tr style={{ background: "#f9fafb", color: "#4b5563", borderBottom: "2px solid #e5e7eb", position: "sticky", top: 0, zIndex: 10 }}>
                <th style={{ padding: "12px 16px", position: "sticky", left: 0, background: "#f9fafb", zIndex: 11, borderRight: "1px solid #e5e7eb" }}>Владелец · Регион · Где лежат · Пояснение</th>
                <th style={{ padding: "12px 16px" }}>Валюта</th>
                {effectiveDates.map((d) => (
                  <th key={d} style={{ padding: "12px 16px", textAlign: "right", borderLeft: "1px solid #f3f4f6" }}>{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleLines.map((l) => (
                <tr key={l.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "10px 16px", position: "sticky", left: 0, background: "#fff", zIndex: 5, borderRight: "1px solid #e5e7eb", fontWeight: 500 }}>
                    {l.owner || "—"} · {l.region_name} · {l.bank_name ?? "Наличные"} {l.name ? `(${l.name})` : ""}
                  </td>
                  <td style={{ padding: "10px 16px" }}>
                    <span style={{ background: "#e5e7eb", padding: "2px 6px", borderRadius: 4, fontSize: 11 }}>{l.currency}</span>
                  </td>
                  {effectiveDates.map((d) => {
                    const resolved = getResolvedCell(l.id, d);
                    const isEditing = editingCell?.lineId === l.id && editingCell?.date === d;

                    let bg = undefined;
                    if (resolved?.is_draft) bg = DRAFT_BG;
                    if (isEditing) bg = "#eff6ff";

                    return (
                      <td 
                        key={d} 
                        style={{ 
                          padding: "8px 12px", 
                          textAlign: "right", 
                          borderLeft: "1px solid #f3f4f6", 
                          background: bg,
                          fontWeight: resolved?.isReal ? 600 : 400,
                          color: resolved?.isReal ? "#111827" : "#9ca3af",
                          position: "relative"
                        }}
                        className="matrix-cell"
                      >
                        {isEditing ? (
                          <input 
                            autoFocus
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => handleSaveCell(l.id, d, editValue)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveCell(l.id, d, editValue);
                              if (e.key === "Escape") setEditingCell(null);
                            }}
                            ref={(input) => {
                              if (input) {
                                input.focus();
                                input.setSelectionRange(0, 0); // Ставим курсор в самое начало (к левому краю)
                              }
                            }}
                            style={{ width: "80px", padding: "4px 6px", textAlign: "left", borderRadius: 4, border: "1px solid #2563eb", outline: "none" }}
                          />
                        ) : (
                          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6 }}>
                            <span>{resolved?.amount ?? "—"}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingCell({ lineId: l.id, date: d });
                                const direct = directMap.get(`${l.id}_${d}`);
                                setEditValue(direct ? direct.amount : (resolved?.amount ?? ""));
                              }}
                              title="Редактировать остаток"
                              style={{
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                padding: "2px 4px",
                                fontSize: "12px",
                                opacity: 0.4,
                                borderRadius: 4
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.opacity = "1"}
                              onMouseLeave={(e) => e.currentTarget.style.opacity = "0.4"}
                            >
                              ✏️
                            </button>
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {visibleLines.length === 0 && (
                <tr>
                  <td colSpan={effectiveDates.length + 2} style={{ padding: 24, textAlign: "center", color: "#6b7280" }}>
                    Нет счетов для отображения (возможно, все позиции нулевые или скрыты фильтром).
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
