import { AccountsNewTab } from "./AccountsNewTab";
import ReportNewTab from "./ReportNewTab";
import { SnapshotsMatrixTab } from "./SnapshotsMatrix";
import { useCallback, useEffect, useState, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CurrentTab, LinesTab, Snapshots } from "./Balances";
import { BalancesNewTab } from "./BalancesNew";
import ReportTab from "./ReportTab";
import { Amt, AmountInput, DeleteButton, bar, cell, cellR, formatInput, today, whole } from "./ui";

const CURRENCIES = ["KZT", "USD", "EUR", "RUB"];

type Category = { id: number; name: string; type: string; is_interest: boolean };
type Operation = {
  id: number; date: string; type: string; currency: string; amount: string;
  category_id: number | null; category_name: string | null; comment: string | null;
};

function Categories() {
  const [rows, setRows] = useState<Category[]>([]);
  const [name, setName] = useState("");
  const [type, setType] = useState("expense");
  const [isInterest, setIsInterest] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setRows(await invoke<Category[]>("list_categories"));
  }, []);
  useEffect(() => { load().catch((e) => setMsg(String(e))); }, [load]);

  async function act(fn: () => Promise<unknown>) {
    setMsg("");
    try { await fn(); await load(); } catch (e) { setMsg(String(e)); }
  }

  return (
    <div>
      <h3>Категории</h3>
      {msg && <p style={{ color: "#b00" }}>{msg}</p>}
      <div style={bar}>
        <input placeholder="Название" value={name} onChange={(e) => setName(e.target.value)} />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="expense">Расход</option>
          <option value="income">Доход</option>
        </select>
        <label><input type="checkbox" checked={isInterest} onChange={(e) => setIsInterest(e.target.checked)} /> «проценты»</label>
        <button onClick={() => act(async () => { await invoke("add_category", { name, catType: type, isInterest }); setName(""); })}>Добавить</button>
      </div>
      <table style={{ borderCollapse: "collapse" }}>
        <thead><tr><th style={cell}>Название</th><th style={cell}>Тип</th><th style={cell}>«Проценты»</th><th style={cell}></th></tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td style={cell}>{c.name}</td>
              <td style={cell}>{c.type === "income" ? "Доход" : "Расход"}</td>
              <td style={cell}>
                <input
                  type="checkbox"
                  checked={c.is_interest}
                  onChange={(e) => act(() => invoke("update_category", { id: c.id, name: c.name, catType: c.type, isInterest: e.target.checked }))}
                />
              </td>
              <td style={cell}><DeleteButton onConfirm={() => act(() => invoke("delete_category", { id: c.id }))} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Operations({ hide }: { hide: boolean }) {
  const [rows, setRows] = useState<Operation[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [fType, setFType] = useState("");
  const [fCat, setFCat] = useState("");
  const [date, setDate] = useState(today());
  const [opType, setOpType] = useState("expense");
  const [currency, setCurrency] = useState("KZT");
  const [amount, setAmount] = useState("");
  const [catId, setCatId] = useState("");
  const [comment, setComment] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setRows(await invoke<Operation[]>("list_operations", {
      dateFrom: fFrom, dateTo: fTo, opType: fType, categoryId: fCat ? Number(fCat) : null,
    }));
  }, [fFrom, fTo, fType, fCat]);
  useEffect(() => { load().catch((e) => setMsg(String(e))); }, [load]);
  useEffect(() => {
    invoke<Category[]>("list_categories").then(setCats).catch((e) => setMsg(String(e)));
  }, []);

  async function save() {
    setMsg("");
    const args = { date, opType, currency, amount, categoryId: catId ? Number(catId) : null, comment };
    try {
      if (editId === null) await invoke("add_operation", args);
      else await invoke("update_operation", { id: editId, ...args });
      setEditId(null);
      setAmount("");
      setComment("");
      await load();
    } catch (e) { setMsg(String(e)); }
  }

  async function remove(id: number) {
    setMsg("");
    try { await invoke("delete_operation", { id }); await load(); }
    catch (e) { setMsg(String(e)); }
  }

  return (
    <div>
      <h3>Операции</h3>
      <p><small>Операции на баланс не влияют — они нужны для анализа движения баланса в отчёте. Расходы показаны красным.</small></p>
      {msg && <p style={{ color: "#b00" }}>{msg}</p>}
      <div style={bar}>
        <input type="date" value={date} onChange={(e) => { setDate(e.target.value); e.target.blur(); }} />
        <select value={opType} onChange={(e) => { setOpType(e.target.value); setCatId(""); }}>
          <option value="expense">Расход</option>
          <option value="income">Доход</option>
        </select>
        <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <AmountInput value={amount} onChange={setAmount} />
        <select value={catId} onChange={(e) => setCatId(e.target.value)}>
          <option value="">— без категории —</option>
          {cats.filter((c) => c.type === opType).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input placeholder="Комментарий" value={comment} onChange={(e) => setComment(e.target.value)} />
        <button onClick={save}>{editId === null ? "Добавить" : "Сохранить"}</button>
        {editId !== null && <button onClick={() => { setEditId(null); setAmount(""); setComment(""); }}>Отмена</button>}
      </div>
      <div style={bar}>
        <b>Фильтры:</b>
        <input type="date" value={fFrom} onChange={(e) => { setFFrom(e.target.value); e.target.blur(); }} />
        <input type="date" value={fTo} onChange={(e) => { setFTo(e.target.value); e.target.blur(); }} />
        <select value={fType} onChange={(e) => setFType(e.target.value)}>
          <option value="">все типы</option>
          <option value="expense">Расходы</option>
          <option value="income">Доходы</option>
        </select>
        <select value={fCat} onChange={(e) => setFCat(e.target.value)}>
          <option value="">все категории</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <table style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={cell}>Дата</th><th style={cellR}>Сумма</th><th style={cell}>Валюта</th>
            <th style={cell}>Категория</th><th style={cell}>Комментарий</th><th style={cell}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id}>
              <td style={cell}>{o.date}</td>
              <td style={cellR}>
                <span style={{ color: !hide && o.type === "expense" ? "#c00" : undefined }}>{o.type === "income" ? "+" : "−"}</span>
                <Amt a={o.amount} hide={hide} neg={o.type === "expense"} />
              </td>
              <td style={cell}>{o.currency}</td>
              <td style={cell}>{o.category_name ?? "—"}</td>
              <td style={cell}>{o.comment ?? ""}</td>
              <td style={cell}>
                <button
                  onClick={() => {
                    setEditId(o.id); setDate(o.date); setOpType(o.type); setCurrency(o.currency);
                    setAmount(formatInput(whole(o.amount))); setCatId(o.category_id ? String(o.category_id) : ""); setComment(o.comment ?? "");
                  }}
                >Изменить</button>{" "}
                <DeleteButton onConfirm={() => remove(o.id)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const stickyTabs = {
  position: "sticky" as const, top: 60, zIndex: 15, background: "#fff",
  marginLeft: -24, marginRight: -24, padding: "8px 24px", borderBottom: "1px solid #e5e7eb",
  display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" as const, gap: 8
};

type Tab = "accounts_new" | "rep_new" | "matrix_input" | "cur" | "cur_new" | "rep" | "snap" | "lines" | "ops" | "cats" | "rates";

const ALL_TABS: Record<Tab, string> = {
  cur: "Актуальные балансы",
  matrix_input: "Ввод (Матрица)",
  cur_new: "Балансы (новый дизайн)",
  rep: "Отчёт",
  rep_new: "Отчёт (новый)",
  snap: "Ввод позиций",
  lines: "Счета и банки",
  accounts_new: "Счета и банки (новый)",
  ops: "Операции",
  cats: "Категории",
  rates: "Курсы валют",
};

type RateRow = {
  resolved_for_date: string;
  currency: string;
  rate_scaled: number;
  source_date: string;
  source: string;
};

function RatesTab() {
  const [rows, setRows] = useState<RateRow[]>([]);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [targetDate, setTargetDate] = useState(today());

  const load = useCallback(async () => {
    try {
      setRows(await invoke<RateRow[]>("list_exchange_rates"));
    } catch (e) {
      setMsg(String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleFetch() {
    setMsg("");
    setLoading(true);
    try {
      await invoke("fetch_latest_rates", { targetDate });
      await load();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setLoading(false);
    }
  }

  const grouped: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    if (!grouped[r.resolved_for_date]) {
      grouped[r.resolved_for_date] = {};
    }
    grouped[r.resolved_for_date][r.currency] = r.rate_scaled / 1_000_000;
  }

  const dates = Object.keys(grouped).sort().reverse();

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3>Курсы валют (НБРК)</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="date" value={targetDate} onChange={(e) => { setTargetDate(e.target.value); e.target.blur(); }} />
          <button onClick={handleFetch} disabled={loading}>
            {loading ? "Загрузка..." : "Скачать за дату"}
          </button>
        </div>
      </div>
      {msg && <p style={{ color: "#b00" }}>{msg}</p>}
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={cell}>Дата</th>
            <th style={cellR}>USD</th>
            <th style={cellR}>EUR</th>
            <th style={cellR}>RUB</th>
          </tr>
        </thead>
        <tbody>
          {dates.map((d) => (
            <tr key={d}>
              <td style={cell}>{d}</td>
              <td style={cellR}>{grouped[d]["USD"] ? grouped[d]["USD"].toFixed(2) : "—"}</td>
              <td style={cellR}>{grouped[d]["EUR"] ? grouped[d]["EUR"].toFixed(2) : "—"}</td>
              <td style={cellR}>{grouped[d]["RUB"] ? grouped[d]["RUB"].toFixed(2) : "—"}</td>
            </tr>
          ))}
          {dates.length === 0 && (
            <tr>
              <td colSpan={4} style={{ ...cell, textAlign: "center", color: "#666" }}>
                Нет сохраненных курсов. Нажмите «Скачать курсы».
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function Main({ 
  externalSettingsOpen, 
  setExternalSettingsOpen, 
  authSettingsContent 
}: { 
  externalSettingsOpen: boolean; 
  setExternalSettingsOpen: (v: boolean) => void;
  authSettingsContent?: ReactNode;
}) {
  const DEFAULT_ORDER: Tab[] = ["cur", "matrix_input", "cur_new", "rep", "rep_new", "snap", "lines", "accounts_new", "ops", "cats", "rates"];
  
  const [tabOrder, setTabOrder] = useState<Tab[]>(() => {
    try {
      const saved = localStorage.getItem("budgetmaster_tab_order");
      if (saved) {
        const parsed = JSON.parse(saved) as Tab[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          const missing = DEFAULT_ORDER.filter(t => !parsed.includes(t));
          return [...parsed, ...missing];
        }
      }
    } catch {}
    return DEFAULT_ORDER;
  });

  const [visibleTabs, setVisibleTabs] = useState<Record<Tab, boolean>>(() => {
    try {
      const saved = localStorage.getItem("budgetmaster_visible_tabs");
      if (saved) {
        return JSON.parse(saved);
      }
    } catch {}
    const def: Record<string, boolean> = {};
    DEFAULT_ORDER.forEach(t => def[t] = true);
    return def as Record<Tab, boolean>;
  });

  const activeTabs = tabOrder.filter(t => visibleTabs[t] !== false);
  const [tab, setTab] = useState<Tab>(() => activeTabs[0] || "cur");
  const [hide, setHide] = useState(false);

  useEffect(() => {
    if (!activeTabs.includes(tab) && activeTabs.length > 0) {
      setTab(activeTabs[0]);
    }
  }, [activeTabs, tab]);

  function saveConfig(newOrder: Tab[], newVis: Record<Tab, boolean>) {
    setTabOrder(newOrder);
    setVisibleTabs(newVis);
    localStorage.setItem("budgetmaster_tab_order", JSON.stringify(newOrder));
    localStorage.setItem("budgetmaster_visible_tabs", JSON.stringify(newVis));
  }

  function moveTab(index: number, direction: -1 | 1) {
    const newIdx = index + direction;
    if (newIdx < 0 || newIdx >= tabOrder.length) return;
    const copy = [...tabOrder];
    const temp = copy[index];
    copy[index] = copy[newIdx];
    copy[newIdx] = temp;
    saveConfig(copy, visibleTabs);
  }

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={stickyTabs}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {activeTabs.map((k) => (
            <button 
              key={k} 
              disabled={tab === k} 
              onClick={() => setTab(k)}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: tab === k ? "1px solid #2563eb" : "1px solid #d1d5db",
                background: tab === k ? "#2563eb" : "#f9fafb",
                color: tab === k ? "#fff" : "#374151",
                cursor: tab === k ? "default" : "pointer",
                fontWeight: tab === k ? 500 : 400
              }}
            >
              {ALL_TABS[k]}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => setHide(!hide)} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer" }}>
            {hide ? "Показать суммы" : "Скрыть суммы"}
          </button>
        </div>
      </div>

      {externalSettingsOpen && (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20, marginBottom: 20, boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 18 }}>Настройки</h3>
            <button onClick={() => setExternalSettingsOpen(false)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer" }}>✕</button>
          </div>

          {/* Настройки безопасности аккаунта и пароля */}
          {authSettingsContent}

          {/* Настройки вкладок */}
          <div>
            <h4 style={{ margin: "0 0 12px 0", fontSize: 16 }}>Видимость и порядок вкладок</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {tabOrder.map((t, idx) => (
                <div key={t} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "#f9fafb", borderRadius: 8, border: "1px solid #e5e7eb" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontWeight: 500 }}>
                    <input
                      type="checkbox"
                      checked={visibleTabs[t] !== false}
                      onChange={(e) => {
                        const updated = { ...visibleTabs, [t]: e.target.checked };
                        saveConfig(tabOrder, updated);
                      }}
                    />
                    {ALL_TABS[t]}
                  </label>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button disabled={idx === 0} onClick={() => moveTab(idx, -1)} style={{ padding: "2px 8px", cursor: idx === 0 ? "not-allowed" : "pointer" }}>▲</button>
                    <button disabled={idx === tabOrder.length - 1} onClick={() => moveTab(idx, 1)} style={{ padding: "2px 8px", cursor: idx === tabOrder.length - 1 ? "not-allowed" : "pointer" }}>▼</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "cur" && <CurrentTab hide={hide} />}
      {tab === "cur_new" && <BalancesNewTab hide={hide} />}
      {tab === "rep" && <ReportTab hide={hide} />}
      {tab === "rep_new" && <ReportNewTab hide={hide} />}
      {tab === "snap" && <Snapshots hide={hide} />}
      {tab === "lines" && <LinesTab />}
      {tab === "accounts_new" && <AccountsNewTab hide={hide} />}
      {tab === "ops" && <Operations hide={hide} />}
      {tab === "cats" && <Categories />}
      {tab === "rates" && <RatesTab />}
      {tab === "matrix_input" && <SnapshotsMatrixTab hide={hide} />}
    </div>
  );
}
