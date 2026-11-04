import { useState } from "react";

export const RED = "#c00";
export const today = () => new Date().toLocaleDateString("sv-SE");
export const cell = { padding: "4px 8px", borderBottom: "1px solid #ddd", textAlign: "left" as const };
export const cellR = { padding: "4px 8px", borderBottom: "1px solid #ddd", textAlign: "right" as const, whiteSpace: "nowrap" as const };
export const bar = { display: "flex", gap: 8, flexWrap: "wrap" as const, marginBottom: 12, alignItems: "center" };

/** "123000,5" -> "123 000.5"; допускает минус и не более 2 знаков после точки. */
export function formatInput(raw: string): string {
  let s = raw.replace(/,/g, ".").replace(/[^\d.-]/g, "");
  const neg = s.startsWith("-");
  s = s.replace(/-/g, "");
  const i = s.indexOf(".");
  let intPart = i === -1 ? s : s.slice(0, i);
  const frac = i === -1 ? null : s.slice(i + 1).replace(/\./g, "").slice(0, 2);
  intPart = intPart.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
  return (neg ? "-" : "") + intPart + (frac !== null ? "." + frac : "");
}

export function AmountInput(props: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      inputMode="decimal"
      placeholder={props.placeholder ?? "Сумма"}
      value={props.value}
      onChange={(e) => props.onChange(formatInput(e.target.value))}
      style={{ textAlign: "right" }}
    />
  );
}

/** Сумма: отрицательные красным; при скрытии суммы цвет не показывается. */
export function Amt({ a, hide, neg }: { a: string; hide: boolean; neg?: boolean }) {
  if (hide) return <span>••••</span>;
  const isNeg = neg ?? a.startsWith("-");
  return <span style={{ color: isNeg ? RED : undefined }}>{a}</span>;
}

export function DeleteButton({ onConfirm, text }: { onConfirm: () => void; text?: string }) {
  const [armed, setArmed] = useState(false);
  return armed ? (
    <>
      <button onClick={() => { setArmed(false); onConfirm(); }}>Точно?</button>
      <button onClick={() => setArmed(false)}>Нет</button>
    </>
  ) : (
    <button onClick={() => setArmed(true)}>{text ?? "Удалить"}</button>
  );
}
