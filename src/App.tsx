import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export default function App() {
  const [user, setUser] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [msg, setMsg] = useState("");
  const [tables, setTables] = useState<number | null>(null);

  async function refresh() {
    const u = await invoke<string | null>("session_info");
    setUser(u);
    setAccounts(await invoke<string[]>("list_accounts"));
    setTables(u ? await invoke<number>("table_count") : null);
  }

  useEffect(() => {
    refresh().catch((e) => setMsg(String(e)));
  }, []);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setMsg("");
    try {
      await fn();
      setMsg(ok);
    } catch (e) {
      setMsg(String(e));
    }
    setPassword("");
    setOldPw("");
    setNewPw("");
    await refresh().catch(() => {});
  }

  const box = { display: "flex", flexDirection: "column" as const, gap: 8, maxWidth: 360, marginBottom: 24 };

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h2>BudgetMaster</h2>
      {msg && <p style={{ color: "#b00" }}>{msg}</p>}

      {!user ? (
        <>
          <div style={box}>
            <h3>Вход</h3>
            <select value={name} onChange={(e) => setName(e.target.value)}>
              <option value="">— выберите учётку —</option>
              {accounts.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            <input type="password" placeholder="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button onClick={() => run(() => invoke("login", { name, password }), "Вход выполнен")}>Войти</button>
          </div>
          <div style={box}>
            <h3>Создать учётку</h3>
            <input placeholder="Имя" value={name} onChange={(e) => setName(e.target.value)} />
            <input type="password" placeholder="Пароль (≥ 8 символов)" value={password} onChange={(e) => setPassword(e.target.value)} />
            <small>Пароль нельзя восстановить. При утере данные будут потеряны безвозвратно.</small>
            <button onClick={() => run(() => invoke("create_account", { name, password }), "Учётка создана")}>Создать</button>
          </div>
        </>
      ) : (
        <>
          <p>Вы вошли как <b>{user}</b>. Таблиц в БД: {tables}</p>
          <div style={box}>
            <h3>Сменить пароль</h3>
            <input type="password" placeholder="Текущий пароль" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
            <input type="password" placeholder="Новый пароль" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            <button onClick={() => run(() => invoke("change_password", { oldPassword: oldPw, newPassword: newPw }), "Пароль изменён")}>Сменить</button>
          </div>
          <button onClick={() => run(() => invoke("logout"), "Вы вышли")}>Выйти</button>
        </>
      )}
    </div>
  );
}
