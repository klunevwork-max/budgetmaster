import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CurrentTab, LinesTab, Snapshots } from "./Balances";
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
  position: "sticky" as const, top: 56, zIndex: 15, background: "#fff",
  marginLeft: -24, marginRight: -24, padding: "8px 24px", borderBottom: "1px solid #ddd",
};

type Tab = "cur" | "rep" | "snap" | "lines" | "ops" | "cats" | "rates";
const TABS: [Tab, string][] = [
  ["cur", "Актуальные балансы"],
  ["rep", "Отчёт"],
  ["snap", "Ввод позиций"],
  ["lines", "Счета и банки"],
  ["ops", "Операции"],
  ["cats", "Категории"],
  ["rates", "Курсы валют"],
];


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

export default function Main() {
  const [tab, setTab] = useState<Tab>("cur");
  const [hide, setHide] = useState(false);
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ ...bar, ...stickyTabs }}>
        {TABS.map(([k, t]) => (
          <button key={k} disabled={tab === k} onClick={() => setTab(k)}>{t}</button>
        ))}
        <button onClick={() => setHide(!hide)}>{hide ? "Показать суммы" : "Скрыть суммы"}</button>
      </div>
      {tab === "cur" && <CurrentTab hide={hide} />}
      {tab === "rep" && <ReportTab hide={hide} />}
      {tab === "snap" && <Snapshots hide={hide} />}
      {tab === "lines" && <LinesTab />}
      {tab === "ops" && <Operations hide={hide} />}
      {tab === "cats" && <Categories />}
      {tab === "rates" && <RatesTab />}
    </div>
  );
}
