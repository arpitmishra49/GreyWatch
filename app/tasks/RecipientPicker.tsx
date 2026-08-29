"use client";

import { useState, type KeyboardEvent } from "react";

interface RecipientPickerProps {
  recipients: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  hint?: string;
}

export function RecipientPicker({
  recipients,
  onChange,
  placeholder = "Slack member ID, e.g. U0123ABC456",
  hint = "Each recipient gets a DM (with screenshot) on breach, threaded independently, in addition to the L3 channel. Leave empty to post to the L3 channel only.",
}: RecipientPickerProps) {
  const [draft, setDraft] = useState("");

  function addRecipient() {
    const value = draft.trim();
    if (!value) return;
    if (recipients.includes(value)) {
      setDraft("");
      return;
    }
    onChange([...recipients, value]);
    setDraft("");
  }

  function removeRecipient(value: string) {
    onChange(recipients.filter((r) => r !== value));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addRecipient();
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          style={{ flex: 1 }}
        />
        <button type="button" onClick={addRecipient}>
          Add
        </button>
      </div>
      {recipients.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          {recipients.map((r) => (
            <span key={r} className="filter-chip active" style={{ cursor: "default" }}>
              {r}
              <button
                type="button"
                className="ghost"
                onClick={() => removeRecipient(r)}
                aria-label={`Remove ${r}`}
                style={{ padding: "0 2px", fontSize: 13, color: "inherit" }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <span className="field-hint">{hint}</span>
    </div>
  );
}
