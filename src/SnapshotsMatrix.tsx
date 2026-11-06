import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DRAFT_BG } from "./ui";

type Line = {
  id: number;
  owner: string;
  region: string;
  region_name: string;
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
  
  // Локальное состояние редактируемой ячейки: { lineId, date } -> строка ввода
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

  // Собираем ВСЕ уникальные даты, где реально есть хотя бы один снапшот, сортируем по возрастанию
  const rawDates = Array.from(new Set(snapshots.map((s) => s.date))).sort();
  // Если снапшотов нет вообще, показываем хотя бы сегодняшнюю дату
  const datesList = rawDates.length > 0 ? rawDates : [todayStr()];

  // Карта прямых (реально введенных) снапшотов: "lineId_date" -> Snapshot
  const directMap = new Map<string, Snapshot>();
  for (const s of snapshots) {
    directMap.set(`${s.line_id}_${s.date}`, s);
  }

  // Для каждой колонки-даты вычисляем значение с учетом авто-протяжки (carry-forward) с предыдущей даты
  // Возвращает { amount, is_draft, isReal }
  const getResolvedCell = (lineId: number, dateIndex: number) => {
    // Идем назад от текущей даты к прошлому в поисках последнего известного значения для счета
    for (let i = dateIndex; i >= 0; i--) {
      const d = datesList[i];
      const found = directMap.get(`${lineId}_${d}`);
      if (found) {
        const isReal = i === dateIndex;
        return {
          amount: found.amount,
          is_draft: found.is_draft,
          isReal, // true, если в эту дату действительно был ввод; false, если значение унаследовано
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

  return (
    <div style={{ padding: "8px 4px", fontFamily: "inherit" }}>
      {msg && <div style={{ padding: 12, marginBottom: 16, background: "#fee2e2", color: "#b91c1c", borderRadius: 8 }}>{msg}</div>}

      {/* Панель переноса остатков */}
      <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "16px 20px", marginBottom: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.05)", display: "flex", flexWrap: "wrap", gap: 20, alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
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
        <div style={{ fontSize: 13, color: "#4b5563", maxWidth: 600 }}>
          Колонки формируются автоматически по всем датам, где есть история. Пустые ячейки автоматически отображают последний известный остаток (серым курсивом), а реальный ввод подсвечен ярче.
        </div>
      </div>

      {info && <div style={{ padding: "10px 14px", marginBottom: 16, background: "#eff6ff", color: "#1e40af", borderRadius: 8, fontSize: 14 }}>{info}</div>}

      {/* Матричная таблица ввода позиций */}
      <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.05)", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #e5e7eb", background: "#fdfdfd", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: 16, color: "#111827" }}>Матрица динамики позиций по датам ввода</h3>
          <span style={{ fontSize: 13, color: "#6b7280" }}>Кликните на любую ячейку для ввода или изменения остатка</span>
        </div>

        <div style={{ overflowX: "auto", maxHeight: "70vh" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 13, whiteSpace: "nowrap" }}>
            <thead>
              <tr style={{ background: "#f9fafb", color: "#4b5563", borderBottom: "2px solid #e5e7eb", position: "sticky", top: 0, zIndex: 10 }}>
                <th style={{ padding: "12px 16px", position: "sticky", left: 0, background: "#f9fafb", zIndex: 11, borderRight: "1px solid #e5e7eb" }}>Счет / Актив</th>
                <th style={{ padding: "12px 16px" }}>Валюта</th>
                {datesList.map((d) => (
                  <th key={d} style={{ padding: "12px 16px", textAlign: "right", borderLeft: "1px solid #f3f4f6" }}>{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "10px 16px", position: "sticky", left: 0, background: "#fff", zIndex: 5, borderRight: "1px solid #e5e7eb", fontWeight: 500 }}>
                    {l.owner} · {l.place} {l.name ? `(${l.name})` : ""}
                  </td>
                  <td style={{ padding: "10px 16px" }}>
                    <span style={{ background: "#e5e7eb", padding: "2px 6px", borderRadius: 4, fontSize: 11 }}>{l.currency}</span>
                  </td>
                  {datesList.map((d, dateIdx) => {
                    const resolved = getResolvedCell(l.id, dateIdx);
                    const isEditing = editingCell?.lineId === l.id && editingCell?.date === d;

                    // Цвет фона: если черновик — DRAFT_BG, если редактируем — светло-синий, если унаследовано — чуть бледнее
                    let bg = undefined;
                    if (resolved?.is_draft) bg = DRAFT_BG;
                    if (isEditing) bg = "#eff6ff";

                    return (
                      <td 
                        key={d} 
                        onClick={() => {
                          if (!isEditing) {
                            setEditingCell({ lineId: l.id, date: d });
                            // При клике предлагаем то значение, которое реально было введено на эту дату (или пусто)
                            const direct = directMap.get(`${l.id}_${d}`);
                            setEditValue(direct ? direct.amount : (resolved?.amount ?? ""));
                          }
                        }}
                        style={{ 
                          padding: "8px 12px", 
                          textAlign: "right", 
                          borderLeft: "1px solid #f3f4f6", 
                          background: bg,
                          cursor: "pointer",
                          fontWeight: resolved?.isReal ? 600 : 400,
                          color: resolved?.isReal ? "#111827" : "#9ca3af"
                        }}
                        title={resolved?.isReal ? (resolved.is_draft ? "Черновик" : "Зафиксированная позиция") : "Унаследовано с предыдущей даты (кликните для изменения)"}
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
                            style={{ width: "80px", padding: "4px 6px", textAlign: "right", borderRadius: 4, border: "1px solid #2563eb", outline: "none" }}
                          />
                        ) : (
                          resolved?.amount ?? <span style={{ color: "#d1d5db" }}>—</span>
                        )}
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
