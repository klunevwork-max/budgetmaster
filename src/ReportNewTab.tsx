import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Amt, cell, cellR, today } from "./ui";

type Cur = { currency: string; start: string; end: string; delta: string };
type OpsCur = { currency: string; income: string; expense: string };
type RateU = { kind: string; currency: string; rate: string; source_date: string; source: string; gap_days: number };
type Report = {
  start_date: string; end_date: string; auto_start: boolean; currencies: Cur[];
  delta_with_reval: string | null; delta_no_reval: string | null; reval_effect: string | null;
  ops_income: string; ops_expense: string; deposit_real_income: string; ops_net: string; ops_count: number; ops_excluded: number;
  ops_by_currency: OpsCur[]; virtual_monthly: string;
  unmarked_with_reval: string | null; unmarked_no_reval: string | null;
  rates: RateU[]; warnings: string[];
};
type Mode = "both" | "with" | "without";

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export default function ReportNewTab({ hide }: { hide: boolean }) {
  const [end, setEnd] = useState(today());
  const [auto, setAuto] = useState(true);
  const [start, setStart] = useState("");
  const [mode, setMode] = useState<Mode>("both");
  const [rep, setRep] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const startKey = auto ? "" : start;

  useEffect(() => {
    if (!isDate(end)) return;
    if (!auto && !isDate(start)) return;
    let cancelled = false;
    setLoading(true);
    invoke<Report>("build_report", { end, start: auto ? null : start })
      .then((r) => { if (!cancelled) { setRep(r); setMsg(""); } })
      .catch((e) => { if (!cancelled) { setMsg(String(e)); setRep(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [end, auto, startKey]);

  const val = (a: string | null, neg?: boolean) =>
    a === null ? <span>н/д</span> : <Amt a={a} hide={hide} neg={neg} />;
  const showWith = mode !== "without";
  const showNo = mode !== "with";

  return (
    <div style={{ padding: "8px 4px", fontFamily: "inherit" }}>
      <div style={{ marginBottom: 20 }}>
        <h3 style={{ margin: "0 0 6px 0", fontSize: 20, color: "#111827" }}>Отчёт о движении баланса (Новый дизайн)</h3>
        <p style={{ margin: 0, fontSize: 13, color: "#6b7280", lineHeight: 1.5 }}>
          Период (начало, конец]: операции на дату начала не входят, на дату конца входят. Остаток по валюте на дату — сумма последних известных позиций всех счетов. Черновики (жёлтые) в отчёт не входят.
        </p>
      </div>

      {msg && <div style={{ padding: 12, marginBottom: 16, background: "#fee2e2", color: "#b91c1c", borderRadius: 8 }}>{msg}</div>}

      <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "16px 20px", marginBottom: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.05)", display: "flex", flexWrap: "wrap", gap: 20, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Дата отчёта</label>
            <input 
              type="date" 
              value={end} 
              onChange={(e) => { setEnd(e.target.value); e.target.blur(); }} 
              style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #d1d5db", background: "#f9fafb" }} 
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Начало периода</label>
            <input 
              type="date" 
              value={auto ? (rep?.start_date ?? "") : start} 
              disabled={auto} 
              onChange={(e) => { setStart(e.target.value); e.target.blur(); }} 
              style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #d1d5db", background: auto ? "#f3f4f6" : "#f9fafb" }} 
            />
          </div>
        </div>

        <div style={{ borderLeft: "1px solid #e5e7eb", paddingLeft: 20, display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: "#374151" }}>
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => { setAuto(e.target.checked); if (!e.target.checked) setStart(rep?.start_date ?? ""); }}
              style={{ width: 16, height: 16 }}
            />
            Автоматическое начало (предыдущая позиция)
          </label>

          <select 
            value={mode} 
            onChange={(e) => setMode(e.target.value as Mode)}
            style={{ padding: "7px 12px", borderRadius: 6, border: "1px solid #d1d5db", background: "#f9fafb", fontSize: 13 }}
          >
            <option value="both">С переоценкой и без</option>
            <option value="with">С переоценкой</option>
            <option value="without">Без переоценки</option>
          </select>
        </div>

        {loading && <div style={{ fontSize: 13, color: "#2563eb", fontWeight: 500 }}>Загрузка курсов и расчёт…</div>}
      </div>

      {rep && (
        <>
          {rep.warnings.length > 0 && (
            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", padding: "12px 16px", borderRadius: 8, marginBottom: 20 }}>
              {rep.warnings.map((w, i) => <div key={i} style={{ fontSize: 13 }}>⚠ {w}</div>)}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginBottom: 24 }}>
            {showWith && (
              <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
                <div style={{ fontSize: 12, color: "#6b7280", textTransform: "uppercase", fontWeight: 600, marginBottom: 8 }}>Изменение с переоценкой</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: "#111827" }}>{val(rep.delta_with_reval)}</div>
              </div>
            )}
            {showNo && (
              <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
                <div style={{ fontSize: 12, color: "#6b7280", textTransform: "uppercase", fontWeight: 600, marginBottom: 8 }}>Изменение без переоценки</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: "#111827" }}>{val(rep.delta_no_reval)}</div>
              </div>
            )}
            <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
              <div style={{ fontSize: 12, color: "#6b7280", textTransform: "uppercase", fontWeight: 600, marginBottom: 8 }}>Чистый результат операций (Нетто)</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#16a34a" }}>{val(rep.ops_net)}</div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24, alignItems: "start" }}>
            <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.05)", overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: "1px solid #e5e7eb", background: "#f9fafb", fontWeight: 600, fontSize: 14, color: "#374151" }}>
                1. Изменение по валютам ({rep.start_date} → {rep.end_date})
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #e5e7eb", color: "#6b7280" }}>
                    <th style={{ ...cell, padding: "10px 16px" }}>Валюта</th>
                    <th style={{ ...cellR, padding: "10px 16px" }}>На начало</th>
                    <th style={{ ...cellR, padding: "10px 16px" }}>На конец</th>
                    <th style={{ ...cellR, padding: "10px 16px" }}>Изменение</th>
                  </tr>
                </thead>
                <tbody>
                  {rep.currencies.map((c) => (
                    <tr key={c.currency} style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <td style={{ ...cell, padding: "10px 16px", fontWeight: 550 }}>{c.currency}</td>
                      <td style={{ ...cellR, padding: "10px 16px" }}>{val(c.start)}</td>
                      <td style={{ ...cellR, padding: "10px 16px" }}>{val(c.end)}</td>
                      <td style={{ ...cellR, padding: "10px 16px" }}>{val(c.delta)}</td>
                    </tr>
                  ))}
                  {rep.currencies.length === 0 && <tr><td colSpan={4} style={{ padding: 16, textAlign: "center", color: "#6b7280" }}>Нет счетов</td></tr>}
                </tbody>
              </table>
            </div>

            <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.05)", overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: "1px solid #e5e7eb", background: "#f9fafb", fontWeight: 600, fontSize: 14, color: "#374151" }}>
                3. Операции за период (в KZT)
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <tbody>
                  <tr style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ ...cell, padding: "10px 16px" }}>Доходы (включая выплаты по депозитам)</td>
                    <td style={{ ...cellR, padding: "10px 16px", color: "#16a34a" }}>{val(rep.ops_income)}</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ ...cell, padding: "10px 16px" }}>Расходы</td>
                    <td style={{ ...cellR, padding: "10px 16px", color: "#dc2626" }}>{val(rep.ops_expense, true)}</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid #f3f4f6", background: "#f9fafb" }}>
                    <td style={{ ...cell, padding: "10px 16px", fontWeight: 600 }}>Нетто</td>
                    <td style={{ ...cellR, padding: "10px 16px", fontWeight: 600 }}>{val(rep.ops_net)}</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ ...cell, padding: "10px 16px" }}>Начисления по депозитам (фактические)</td>
                    <td style={{ ...cellR, padding: "10px 16px", color: "#16a34a" }}>{rep.deposit_real_income}</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ ...cell, padding: "10px 16px" }}>Виртуальные начисления (будущие)</td>
                    <td style={{ ...cellR, padding: "10px 16px" }}>{rep.virtual_monthly}</td>
                  </tr>
                </tbody>
              </table>
              <div style={{ padding: "10px 16px", fontSize: 12, color: "#6b7280", background: "#f9fafb", borderTop: "1px solid #f3f4f6" }}>
                Операций: {rep.ops_count}{rep.ops_excluded > 0 ? `, без курса исключено: ${rep.ops_excluded}` : ""}.
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24 }}>
            <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
              <h4 style={{ margin: "0 0 12px 0", fontSize: 15, color: "#111827" }}>2. Эффект переоценки в KZT</h4>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <tbody>
                  {showWith && <tr style={{ borderBottom: "1px solid #f3f4f6" }}><td style={{ padding: "8px 0" }}>С переоценкой</td><td style={{ textAlign: "right", padding: "8px 0" }}>{val(rep.delta_with_reval)}</td></tr>}
                  {showNo && <tr style={{ borderBottom: "1px solid #f3f4f6" }}><td style={{ padding: "8px 0" }}>Без переоценки</td><td style={{ textAlign: "right", padding: "8px 0" }}>{val(rep.delta_no_reval)}</td></tr>}
                  <tr><td style={{ padding: "8px 0", fontWeight: 600 }}>Эффект переоценки</td><td style={{ textAlign: "right", padding: "8px 0", fontWeight: 600 }}>{val(rep.reval_effect)}</td></tr>
                </tbody>
              </table>
            </div>

            <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
              <h4 style={{ margin: "0 0 12px 0", fontSize: 15, color: "#111827" }}>4. Неразмеченная разница</h4>
              <div style={{ display: "flex", gap: 24, marginBottom: 8 }}>
                {showWith && (
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>{val(rep.unmarked_with_reval)}</div>
                    <div style={{ fontSize: 11, color: "#6b7280" }}>с переоценкой</div>
                  </div>
                )}
                {showNo && (
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>{val(rep.unmarked_no_reval)}</div>
                    <div style={{ fontSize: 11, color: "#6b7280" }}>без переоценки</div>
                  </div>
                )}
              </div>
              <p style={{ margin: 0, fontSize: 12, color: "#6b7280", lineHeight: 1.4 }}>
                Не объяснено внесёнными операциями (неучтённые доходы/расходы).
              </p>
            </div>
          </div>

          {rep.rates.length > 0 && (
            <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "12px 16px", fontSize: 13, color: "#4b5563", display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
              <span style={{ fontWeight: 600 }}>Курсы НБРК:</span>
              {rep.rates.map((r, i) => (
                <span key={i} style={{ background: "#fff", border: "1px solid #d1d5db", padding: "2px 8px", borderRadius: 4, fontSize: 12 }}>
                  {r.currency}: <b>{r.rate}</b> ({r.kind}, на {r.source_date})
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
