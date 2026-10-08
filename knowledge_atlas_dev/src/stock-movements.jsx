import { Select } from "./select.jsx";
import React, { useState } from "react";
import { t, locale } from "../shared/i18n.js";
import { api } from "./client.js";
import { locationLabel } from "../shared/locations.js";

export function StockMovements({ node, settings, onChanged }) {
  const [form, setForm] = useState({
      kind: "transfer",
      from: "",
      to: "",
      quantity: 1,
      borrower: "",
      loanId: "",
      note: "",
      operationId: crypto.randomUUID(),
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const change = (key, value) =>
    setForm((f) => ({ ...f, [key]: value, operationId: crypto.randomUUID() }));
  const label = (p) =>
    `${locationLabel(settings.locations, p.locationId)} · ${p.detail} (${p.quantity})`;
  return (
    <details className="stock-movements">
      <summary>{t("movement.title")}</summary>
      <label>
        {t("movement.kind")}
        <Select
          value={form.kind}
          onChange={(e) => change("kind", e.target.value)}
        >
          {["transfer", "loan", "return"].map((kind) => (
            <option key={kind} value={kind}>
              {t(`movement.${kind}`)}
            </option>
          ))}
        </Select>
      </label>
      {form.kind !== "return" && (
        <label>
          {t("movement.from")}
          <Select
            value={form.from}
            onChange={(e) => change("from", e.target.value)}
          >
            <option value="">—</option>
            {node.stock.placements.map((p) => (
              <option key={p.id} value={p.id}>
                {label(p)}
              </option>
            ))}
          </Select>
        </label>
      )}
      {form.kind !== "loan" && (
        <label>
          {t("movement.to")}
          <Select
            value={form.to}
            onChange={(e) => change("to", e.target.value)}
          >
            <option value="">—</option>
            {node.stock.placements.map((p) => (
              <option key={p.id} value={p.id}>
                {label(p)}
              </option>
            ))}
          </Select>
        </label>
      )}
      {form.kind === "loan" && (
        <label>
          {t("movement.borrower")}
          <input
            value={form.borrower}
            maxLength={120}
            onChange={(e) => change("borrower", e.target.value)}
          />
        </label>
      )}
      {form.kind === "return" && (
        <label>
          {t("movement.loan")}
          <Select
            value={form.loanId}
            onChange={(e) => change("loanId", e.target.value)}
          >
            <option value="">—</option>
            {(node.stock.loans || [])
              .filter((l) => l.quantity > 0)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.borrower} ({l.quantity})
                </option>
              ))}
          </Select>
        </label>
      )}
      <label>
        {t("stock.quantity")}
        <input
          type="number"
          min="1"
          value={form.quantity}
          onChange={(e) => change("quantity", Number(e.target.value))}
        />
      </label>
      <label>
        {t("movement.note")}
        <input
          value={form.note}
          maxLength={2000}
          onChange={(e) => change("note", e.target.value)}
        />
      </label>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <button
        className="secondary-button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await api(`nodes/${node.id}/movements`, {
              method: "POST",
              body: JSON.stringify({ ...form, revision: node.revision }),
            });
            await onChanged();
            setForm((f) => ({ ...f, operationId: crypto.randomUUID() }));
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? t("m022") : t("movement.save")}
      </button>
      <p>
        {t(
          "movement.outstanding",
          (node.stock.loans || []).reduce((sum, l) => sum + l.quantity, 0),
        )}
      </p>
      {(node.stock.movements || [])
        .slice(-20)
        .reverse()
        .map((m) => (
          <p className="field-help" key={m.id}>
            {new Date(m.at).toLocaleString(locale())} ·{" "}
            {t(`movement.${m.request.kind}`)} · {m.request.quantity} ·{" "}
            {m.request.borrower || m.request.note}
          </p>
        ))}
    </details>
  );
}
