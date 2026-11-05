"use client";

import { useState } from "react";

import { PASSWORD_MAX, PASSWORD_MIN, passwordStrength } from "@/lib/auth/password-strength";

/**
 * Campo de contraseña con «Mostrar/Ocultar» (botón de 44 px dentro del
 * campo) y, al crearla, una pista de fortaleza que se lee mientras se
 * escribe. La pista no bloquea: la única regla es la longitud mínima.
 */
export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  showStrength = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "new-password" | "current-password";
  showStrength?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const strength = passwordStrength(value);
  const hintId = `${id}-hint`;
  return (
    <div className="ac-field">
      <label htmlFor={id} className="ac-label">
        {label}
      </label>
      <div className="ac-pw">
        <input
          id={id}
          name="password"
          type={visible ? "text" : "password"}
          className="ac-input ac-input--pw"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required
          minLength={showStrength ? PASSWORD_MIN : undefined}
          maxLength={showStrength ? PASSWORD_MAX : 200}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby={showStrength ? hintId : undefined}
        />
        <button
          type="button"
          className="ac-pw-toggle"
          aria-pressed={visible}
          aria-controls={id}
          aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? "Ocultar" : "Mostrar"}
        </button>
      </div>
      {showStrength ? (
        <div id={hintId} className="ac-meter" data-score={value ? strength.score : undefined}>
          <span className="ac-meter-bar" aria-hidden="true">
            <i /><i /><i /><i />
          </span>
          {/* Solo se anuncia el nivel, no cada tecla. */}
          <span className="ac-hint" aria-live="polite">
            {value ? strength.label : `Al menos ${PASSWORD_MIN} caracteres. Mejor si mezcláis letras, números y símbolos.`}
          </span>
        </div>
      ) : null}
    </div>
  );
}
