import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type RecKind = "code" | "question" | "none";
type RecInfo = { kind: string; question: string | null } | null;

const box = { display: "flex", flexDirection: "column" as const, gap: 8, maxWidth: 380, marginBottom: 24 };

function RecoveryChooser(props: {
  kind: RecKind; setKind: (k: RecKind) => void;
  question: string; setQuestion: (s: string) => void;
  answer: string; setAnswer: (s: string) => void;
}) {
  const { kind, setKind, question, setQuestion, answer, setAnswer } = props;
  return (
    <div style={box}>
      <b>Восстановление пароля</b>
      <label><input type="radio" checked={kind === "code"} onChange={() => setKind("code")} /> Код восстановления (рекомендуется)</label>
      <label><input type="radio" checked={kind === "question"} onChange={() => setKind("question")} /> Контрольный вопрос</label>
      <label><input type="radio" checked={kind === "none"} onChange={() => setKind("none")} /> Без восстановления</label>
      {kind === "code" && <small>Будет сгенерирован код. Сохраните его в менеджер паролей или на бумагу — он показывается один раз.</small>}
      {kind === "question" && (
        <>
          <input placeholder="Ваш вопрос" value={question} onChange={(e) => setQuestion(e.target.value)} />
          <input placeholder="Ответ (от 12 символов, лучше фраза)" value={answer} onChange={(e) => setAnswer(e.target.value)} />
          <small style={{ color: "#b60" }}>Слабее кода: ответ, который можно угадать или найти о вас, снижает защиту всех данных. Не используйте очевидные факты.</small>
        </>
      )}
      {kind === "none" && <small style={{ color: "#b60" }}>При утере пароля данные будут потеряны безвозвратно.</small>}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [view, setView] = useState<"login" | "create" | "forgot">("login");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [kind, setKind] = useState<RecKind>("code");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [secret, setSecret] = useState("");
  const [recInfo, setRecInfo] = useState<RecInfo | undefined>(undefined);
  const [codeToShow, setCodeToShow] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [tables, setTables] = useState<number | null>(null);

  async function refresh() {
    const u = await invoke<string | null>("session_info");
    setUser(u);
    setAccounts(await invoke<string[]>("list_accounts"));
    setTables(u ? await invoke<number>("table_count") : null);
  }

  useEffect(() => { refresh().catch((e) => setMsg(String(e))); }, []);

  function clearSecrets() {
    setPassword(""); setOldPw(""); setNewPw(""); setAnswer(""); setSecret("");
  }

  async function run(fn: () => Promise<unknown>, ok: string) {
    setMsg("");
    try { await fn(); setMsg(ok); } catch (e) { setMsg(String(e)); }
    clearSecrets();
    await refresh().catch(() => {});
  }

  async function loadRecInfo(n: string) {
    setName(n);
    setRecInfo(undefined);
    if (!n) return;
    try { setRecInfo(await invoke<RecInfo>("recovery_info", { name: n })); }
    catch (e) { setMsg(String(e)); }
  }

  if (codeToShow) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <h2>Код восстановления</h2>
        <p style={{ fontSize: 24, letterSpacing: 2, fontFamily: "monospace" }}>{codeToShow}</p>
        <p>Сохраните его сейчас (менеджер паролей или бумага). Он <b>не будет показан снова</b>. Без пароля и без этого кода данные не восстановить.</p>
        <button onClick={() => setCodeToShow(null)}>Я сохранил код</button>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h2>BudgetMaster</h2>
      {msg && <p style={{ color: "#b00" }}>{msg}</p>}

      {!user && view === "login" && (
        <div style={box}>
          <h3>Вход</h3>
          <select value={name} onChange={(e) => setName(e.target.value)}>
            <option value="">— выберите учётку —</option>
            {accounts.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <input type="password" placeholder="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button onClick={() => run(() => invoke("login", { name, password }), "Вход выполнен")}>Войти</button>
          <button onClick={() => { setMsg(""); setView("forgot"); loadRecInfo(name); }}>Забыли пароль?</button>
          <button onClick={() => { setMsg(""); setName(""); setView("create"); }}>Создать учётку</button>
        </div>
      )}

      {!user && view === "create" && (
        <div style={box}>
          <h3>Создать учётку</h3>
          <input placeholder="Имя" value={name} onChange={(e) => setName(e.target.value)} />
          <input type="password" placeholder="Пароль (≥ 8 символов)" value={password} onChange={(e) => setPassword(e.target.value)} />
          <RecoveryChooser {...{ kind, setKind, question, setQuestion, answer, setAnswer }} />
          <button
            onClick={() =>
              run(async () => {
                const code = await invoke<string | null>("create_account", {
                  name, password, recoveryKind: kind, question, answer,
                });
                if (code) setCodeToShow(code);
                setView("login");
              }, "Учётка создана")
            }
          >Создать</button>
          <button onClick={() => setView("login")}>Назад</button>
        </div>
      )}

      {!user && view === "forgot" && (
        <div style={box}>
          <h3>Восстановление пароля</h3>
          <select value={name} onChange={(e) => loadRecInfo(e.target.value)}>
            <option value="">— выберите учётку —</option>
            {accounts.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          {recInfo === null && name && <p>Для этой учётки восстановление не настроено.</p>}
          {recInfo && (
            <>
              {recInfo.kind === "question"
                ? <p>Вопрос: <b>{recInfo.question}</b></p>
                : <p>Введите код восстановления.</p>}
              <input placeholder={recInfo.kind === "question" ? "Ответ" : "Код восстановления"} value={secret} onChange={(e) => setSecret(e.target.value)} />
              <input type="password" placeholder="Новый пароль (≥ 8 символов)" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
              <button onClick={() => run(() => invoke("recover_account", { name, secret, newPassword: newPw }), "Пароль восстановлен, вход выполнен")}>Восстановить</button>
            </>
          )}
          <button onClick={() => setView("login")}>Назад</button>
        </div>
      )}

      {user && (
        <>
          <p>Вы вошли как <b>{user}</b>. Таблиц в БД: {tables}</p>
          <div style={box}>
            <h3>Сменить пароль</h3>
            <input type="password" placeholder="Текущий пароль" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
            <input type="password" placeholder="Новый пароль" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            <button onClick={() => run(() => invoke("change_password", { oldPassword: oldPw, newPassword: newPw }), "Пароль изменён")}>Сменить</button>
          </div>
          <div style={box}>
            <h3>Настроить восстановление</h3>
            <input type="password" placeholder="Текущий пароль" value={password} onChange={(e) => setPassword(e.target.value)} />
            <RecoveryChooser {...{ kind, setKind, question, setQuestion, answer, setAnswer }} />
            <button
              onClick={() =>
                run(async () => {
                  const code = await invoke<string | null>("set_recovery", {
                    password, recoveryKind: kind, question, answer,
                  });
                  if (code) setCodeToShow(code);
                }, "Восстановление настроено")
              }
            >Применить</button>
          </div>
          <button onClick={() => run(() => invoke("logout"), "Вы вышли")}>Выйти</button>
        </>
      )}
    </div>
  );
}
