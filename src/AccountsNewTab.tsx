import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DeleteButton } from "./ui";

const CURRENCIES = ["KZT", "USD", "EUR", "RUB"];
const REGIONS = [{ v: "KZ", t: "Казахстан" }, { v: "RU", t: "Россия" }];
const regionName = (v: string) => REGIONS.find((r) => r.v === v)?.t ?? v;

type Item = { id: number; name: string };
type Line = {
  is_tax: boolean;
  id: number; owner_id: number | null; owner: string; region: string; kind: string;
  bank_id: number | null; bank_name: string | null; name: string; currency: string; label: string;
  is_deposit: boolean; interest_rate_bps: number;
};

export function AccountsNewTab({ hide }: { hide: boolean }) {
  if (hide) return null;

  const [owners, setOwners] = useState<Item[]>([]);
  const [banks, setBanks] = useState<Item[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [ownerSel, setOwnerSel] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const [region, setRegion] = useState("KZ");
  const [kind, setKind] = useState("bank");
  const [bankSel, setBankSel] = useState("");
  const [newBank, setNewBank] = useState("");
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("KZT");
  
  const [isDeposit, setIsDeposit] = useState(false);
  const [isTax, setIsTax] = useState(false);
  const [interestRate, setInterestRate] = useState("");

  const [editId, setEditId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const os = await invoke<Item[]>("list_owners");
    setOwners(os);
    setBanks(await invoke<Item[]>("list_banks"));
    setLines(await invoke<Line[]>("list_lines"));
    setOwnerSel((prev) => prev || (os[0] ? String(os[0].id) : ""));
  }, []);

  useEffect(() => { load().catch((e) => setMsg(String(e))); }, [load]);

  async function act(fn: () => Promise<unknown>): Promise<boolean> {
    setMsg("");
    try { await fn(); await load(); return true; }
    catch (e) { setMsg(String(e)); return false; }
  }

  function resetForm() {
    setEditId(null);
    setName("");
    setIsDeposit(false);
    setIsTax(false);
    setInterestRate("");
  }

  async function saveLine() {
    await act(async () => {
      if (!ownerSel || ownerSel === "__new__") throw "Выберите владельца";
      const ownerId = Number(ownerSel);
      const bankId = kind === "bank" && bankSel && bankSel !== "__new__" ? Number(bankSel) : null;
      
      const parsedRate = parseFloat(interestRate.replace(",", ".")) || 0;
      const interestRateBps = Math.round(parsedRate * 100);

      if (editId === null) {
        await invoke("add_line", { 
          ownerId, 
          region, 
          kind, 
          bankId, 
          name, 
          currency, 
          isDeposit, 
          interestRateBps,
          isTax
        });
      } else {
        await invoke("update_line", { 
          id: editId, 
          ownerId, 
          region, 
          bankId, 
          name, 
          isDeposit, 
          interestRateBps,
          isTax
        });
      }
      resetForm();
    });
  }

  return (
    <div style={{ padding: "8px 4px", fontFamily: "inherit" }}>
      <div style={{ marginBottom: 20 }}>
        <h3 style={{ margin: "0 0 6px 0", fontSize: 20, color: "#111827" }}>Счета и банки (Новый дизайн)</h3>
        <p style={{ margin: 0, fontSize: 13, color: "#6b7280", lineHeight: 1.5 }}>
          Справочник счетов, кошельков и депозитов. Управление владельцами и банками.
        </p>
      </div>

      {msg && <div style={{ padding: 12, marginBottom: 16, background: "#fee2e2", color: "#b91c1c", borderRadius: 8 }}>{msg}</div>}

      {/* Панель добавления / редактирования счета */}
      <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "20px", marginBottom: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
        <h4 style={{ margin: "0 0 16px 0", fontSize: 15, color: "#111827" }}>
          {editId === null ? "➕ Добавить новый счёт" : "✏️ Редактировать счёт"}
        </h4>
        
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
          <select value={ownerSel} onChange={(e) => setOwnerSel(e.target.value)} style={{ padding: "7px 12px", borderRadius: 6, border: "1px solid #d1d5db", background: "#f9fafb" }}>
            <option value="">— владелец —</option>
            {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            <option value="__new__">＋ Добавить владельца…</option>
          </select>

          {ownerSel === "__new__" && (
            <div style={{ display: "flex", gap: 8 }}>
              <input placeholder="Имя владельца" value={newOwner} onChange={(e) => setNewOwner(e.target.value)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #d1d5db" }} />
              <button onClick={() => act(async () => { const id = await invoke<number>("add_owner", { name: newOwner }); setOwnerSel(String(id)); setNewOwner(""); })} style={{ background: "#2563eb", color: "#fff", border: "none", padding: "6px 12px", borderRadius: 6, cursor: "pointer" }}>Добавить</button>
            </div>
          )}

          <select value={region} onChange={(e) => setRegion(e.target.value)} style={{ padding: "7px 12px", borderRadius: 6, border: "1px solid #d1d5db", background: "#f9fafb" }}>
            {REGIONS.map((r) => <option key={r.v} value={r.v}>{r.t}</option>)}
          </select>

          <select value={kind} disabled={editId !== null} onChange={(e) => setKind(e.target.value)} style={{ padding: "7px 12px", borderRadius: 6, border: "1px solid #d1d5db", background: "#f9fafb" }}>
            <option value="bank">Банк</option>
            <option value="cash">Наличные</option>
          </select>

          {kind === "bank" && (
            <select value={bankSel} onChange={(e) => setBankSel(e.target.value)} style={{ padding: "7px 12px", borderRadius: 6, border: "1px solid #d1d5db", background: "#f9fafb" }}>
              <option value="">— банк —</option>
              {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              <option value="__new__">＋ Добавить банк…</option>
            </select>
          )}

          {kind === "bank" && bankSel === "__new__" && (
            <div style={{ display: "flex", gap: 8 }}>
              <input placeholder="Название банка" value={newBank} onChange={(e) => setNewBank(e.target.value)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #d1d5db" }} />
              <button onClick={() => act(async () => { const id = await invoke<number>("add_bank", { name: newBank }); setBankSel(String(id)); setNewBank(""); })} style={{ background: "#2563eb", color: "#fff", border: "none", padding: "6px 12px", borderRadius: 6, cursor: "pointer" }}>Добавить</button>
            </div>
          )}

          <input placeholder="Пояснение (например, Gold, Зарплатный)" value={name} onChange={(e) => setName(e.target.value)} style={{ padding: "7px 12px", borderRadius: 6, border: "1px solid #d1d5db", minWidth: 220 }} />

          <select value={currency} disabled={editId !== null} onChange={(e) => setCurrency(e.target.value)} style={{ padding: "7px 12px", borderRadius: 6, border: "1px solid #d1d5db", background: "#f9fafb" }}>
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select>

          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13 }}>
            <input type="checkbox" checked={isTax} onChange={(e) => setIsTax(e.target.checked)} style={{ width: 16, height: 16 }} /> Налог
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13 }}>
            <input type="checkbox" checked={isDeposit} onChange={(e) => setIsDeposit(e.target.checked)} style={{ width: 16, height: 16 }} /> Депозит
          </label>

          {isDeposit && (
            <input placeholder="Ставка % (14.5)" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #d1d5db", width: 120 }} />
          )}

          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            <button onClick={saveLine} style={{ background: "#2563eb", color: "#fff", border: "none", padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontWeight: 500 }}>
              {editId === null ? "Добавить счёт" : "Сохранить"}
            </button>
            {editId !== null && (
              <button onClick={resetForm} style={{ background: "#6b7280", color: "#fff", border: "none", padding: "8px 16px", borderRadius: 6, cursor: "pointer" }}>Отмена</button>
            )}
          </div>
        </div>
      </div>

      {/* Список счетов */}
      <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.05)", overflow: "hidden", marginBottom: 24 }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #e5e7eb", background: "#f9fafb", fontWeight: 600, fontSize: 14, color: "#374151" }}>
          Список счетов ({lines.length})
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #e5e7eb", color: "#6b7280", textAlign: "left" }}>
              <th style={{ padding: "10px 16px" }}>Владелец</th>
              <th style={{ padding: "10px 16px" }}>Регион</th>
              <th style={{ padding: "10px 16px" }}>Где лежат</th>
              <th style={{ padding: "10px 16px" }}>Пояснение</th>
              <th style={{ padding: "10px 16px" }}>Валюта</th>
              <th style={{ padding: "10px 16px" }}>Тип / Ставка</th>
              <th style={{ padding: "10px 16px", textAlign: "right" }}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={{ padding: "10px 16px", fontWeight: 550 }}>{l.owner || "—"}</td>
                <td style={{ padding: "10px 16px" }}>{regionName(l.region)}</td>
                <td style={{ padding: "10px 16px" }}>{l.bank_name ?? "Наличные"}</td>
                <td style={{ padding: "10px 16px" }}>{l.name}</td>
                <td style={{ padding: "10px 16px" }}>
                  <span style={{ background: "#e5e7eb", padding: "2px 6px", borderRadius: 4, fontSize: 11 }}>{l.currency}</span>
                </td>
                <td style={{ padding: "10px 16px" }}>
                  {l.is_tax && <span style={{ marginRight: 6, padding: "2px 6px", background: "#fee2e2", color: "#b91c1c", borderRadius: 4, fontSize: 11, fontWeight: 600 }}>Налог</span>}
                  {l.is_deposit ? `Депозит (${(l.interest_rate_bps / 100).toFixed(2)}%)` : "Обычный"}
                </td>
                <td style={{ padding: "10px 16px", textAlign: "right" }}>
                  <button
                    onClick={() => {
                      setEditId(l.id); 
                      setOwnerSel(l.owner_id ? String(l.owner_id) : ""); 
                      setRegion(l.region);
                      setKind(l.kind); 
                      setBankSel(l.bank_id ? String(l.bank_id) : ""); 
                      setName(l.name); 
                      setCurrency(l.currency);
                      setIsDeposit(l.is_deposit);
                      setIsTax(l.is_tax);
                      setInterestRate(l.is_deposit ? (l.interest_rate_bps / 100).toString() : "");
                    }}
                    style={{ background: "#f3f4f6", border: "1px solid #d1d5db", padding: "4px 8px", borderRadius: 4, cursor: "pointer", marginRight: 6, fontSize: 12 }}
                  >
                    Изменить
                  </button>
                  <DeleteButton text="Удалить" onConfirm={() => { void act(() => invoke("delete_line", { id: l.id })); }} />
                </td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", color: "#6b7280" }}>Нет счетов. Добавьте первый счёт выше.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Управление справочниками владельцев и банков */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
          <h4 style={{ margin: "0 0 12px 0", fontSize: 15, color: "#111827" }}>Владельцы</h4>
          <DictListUI items={owners} onRename={(id, n) => act(() => invoke("rename_owner", { id, name: n }))} onDelete={(id) => act(() => invoke("delete_owner", { id }))} />
        </div>
        <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
          <h4 style={{ margin: "0 0 12px 0", fontSize: 15, color: "#111827" }}>Банки</h4>
          <DictListUI items={banks} onRename={(id, n) => act(() => invoke("rename_bank", { id, name: n }))} onDelete={(id) => act(() => invoke("delete_bank", { id }))} />
        </div>
      </div>
      <p style={{ marginTop: 12, fontSize: 12, color: "#6b7280" }}>Владельца и банк можно удалить, только если нет счетов, которые их используют.</p>
    </div>
  );
}

function DictListUI(props: {
  items: Item[];
  onRename: (id: number, name: string) => Promise<boolean>;
  onDelete: (id: number) => Promise<boolean>;
}) {
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <tbody>
        {props.items.map((it) => (
          <tr key={it.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
            <td style={{ padding: "8px 0" }}>
              {editId === it.id ? (
                <input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #2563eb" }} />
              ) : (
                it.name
              )}
            </td>
            <td style={{ padding: "8px 0", textAlign: "right" }}>
              {editId === it.id ? (
                <>
                  <button onClick={async () => { if (await props.onRename(it.id, editName)) setEditId(null); }} style={{ background: "#16a34a", color: "#fff", border: "none", padding: "4px 8px", borderRadius: 4, cursor: "pointer", marginRight: 4, fontSize: 12 }}>Сохранить</button>
                  <button onClick={() => setEditId(null)} style={{ background: "#6b7280", color: "#fff", border: "none", padding: "4px 8px", borderRadius: 4, cursor: "pointer", fontSize: 12 }}>Отмена</button>
                </>
              ) : (
                <>
                  <button onClick={() => { setEditId(it.id); setEditName(it.name); }} style={{ background: "#f3f4f6", border: "1px solid #d1d5db", padding: "4px 8px", borderRadius: 4, cursor: "pointer", marginRight: 6, fontSize: 12 }}>Переименовать</button>
                  <DeleteButton text="Удалить" onConfirm={() => { void props.onDelete(it.id); }} />
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
