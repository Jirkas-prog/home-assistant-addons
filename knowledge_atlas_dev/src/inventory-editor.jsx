import { Select } from "./select.jsx";
import React from "react";
import { Plus, X } from "lucide-react";
import { t } from "../shared/i18n.js";
import { locationLabel } from "../shared/locations.js";
import { itemQuantity } from "../shared/inventory.js";

export function InventoryEditor({ node, settings, onChange, onManage }) {
  const locations = settings.locations.filter((l) => l.kind === "physical");
  const stock = node.stock;
  const update = (id, patch) =>
    onChange({
      ...node,
      stock: {
        ...stock,
        placements: stock.placements.map((p) =>
          p.id === id ? { ...p, ...patch } : p,
        ),
      },
    });
  if (!stock)
    return (
      <section className="data-panel">
        <h3>{t("stock.title")}</h3>
        <p>{t(node.id ? "stock.legacy" : "stock.help")}</p>
        <label>
          {t("m193")}
          <input
            type="number"
            required
            min="1"
            max="1000000000"
            value={node.quantity ?? 1}
            onChange={(e) =>
              onChange({ ...node, quantity: Number(e.target.value) })
            }
          />
        </label>
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            onChange({
              ...node,
              stock: {
                mode: "stock",
                placements: [
                  {
                    id: crypto.randomUUID(),
                    locationId: "",
                    detail: "",
                    quantity: node.quantity || 1,
                  },
                ],
              },
            })
          }
        >
          {t("stock.start")}
        </button>
      </section>
    );
  return (
    <section className="data-panel">
      <div className="editor-label">
        <span>{t("stock.title")}</span>
        <button type="button" onClick={onManage}>
          {t("m061")}
        </button>
      </div>
      <p className="field-help">{t("stock.help")}</p>
      <label>
        {t("stock.mode")}
        <Select
          value={stock.mode}
          onChange={(e) =>
            onChange({ ...node, stock: { ...stock, mode: e.target.value } })
          }
        >
          <option value="stock">{t("stock.bulk")}</option>
          <option value="unique">{t("stock.unique")}</option>
        </Select>
      </label>
      {stock.placements.map((p, index) => (
        <div className="stock-placement" key={p.id}>
          <label>
            {t("stock.place", index + 1)}
            <Select
              required
              value={p.locationId}
              onChange={(e) =>
                e.target.value === "__manage"
                  ? onManage()
                  : update(p.id, { locationId: e.target.value })
              }
            >
              <option value="">{t("stock.choose")}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {locationLabel(locations, l.id)}
                </option>
              ))}
              <option value="__manage">{t("m056")}</option>
            </Select>
          </label>
          <label>
            {t("stock.detail")}
            <input
              value={p.detail}
              maxLength={1000}
              onChange={(e) => update(p.id, { detail: e.target.value })}
            />
          </label>
          <label>
            {t("stock.quantity")}
            <input
              type="number"
              min="0"
              max={stock.mode === "unique" ? "1" : "1000000000"}
              required
              value={p.quantity}
              onChange={(e) =>
                update(p.id, { quantity: Number(e.target.value) })
              }
            />
          </label>
          <button
            type="button"
            className="icon-button"
            aria-label={t("stock.remove", index + 1)}
            onClick={() =>
              onChange({
                ...node,
                stock: {
                  ...stock,
                  placements: stock.placements.filter((x) => x.id !== p.id),
                },
              })
            }
          >
            <X size={16} />
          </button>
        </div>
      ))}
      <div className="data-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            onChange({
              ...node,
              stock: {
                ...stock,
                placements: [
                  ...stock.placements,
                  {
                    id: crypto.randomUUID(),
                    locationId: "",
                    detail: "",
                    quantity: 0,
                  },
                ],
              },
            })
          }
        >
          <Plus size={16} />
          {t("stock.add")}
        </button>
        <strong>{t("stock.total", itemQuantity(node))}</strong>
      </div>
    </section>
  );
}
