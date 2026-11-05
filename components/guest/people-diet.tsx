"use client";

/**
 * «Menú y alergias» por persona (ítem 21): tú y cada acompañante, cada uno con
 * su menú (si la boda lo ofrece) y sus casillas de dieta. Parte de la
 * invitación pública: sin dependencias pesadas. Con una nota de salud ya
 * guardada y plegada (`showHealth` false) solo se ven el menú y
 * vegetariano/vegano; las casillas de salud aparecen al pulsar «Cambiarlo».
 */
import { cleanDietOther, DIET_CHIPS, DIET_OTHER_MAX, isHealthTag, toggleDietTag, type PersonDiet } from "@/lib/rsvp-diet";
import { menuMissingHint } from "@/lib/rsvp-form-state";

export function PeopleDiet({ people, labels, menuOptions, showHealth, onChange, labelClass, inputClass, chipClass }: {
  people: PersonDiet[];
  labels: string[];
  menuOptions: ReadonlyArray<{ id: string; label: string }>;
  showHealth: boolean;
  onChange(index: number, person: PersonDiet): void;
  labelClass: string;
  inputClass: string;
  chipClass: string;
}) {
  const hasMenu = menuOptions.length > 0;
  const chips = DIET_CHIPS.filter((chip) => showHealth || !isHealthTag(chip.id));
  const solo = people.length === 1;
  const chosen = people.filter((person) => person.menu && menuOptions.some((option) => option.id === person.menu)).length;
  const menuHint = hasMenu ? menuMissingHint(people.length, chosen) : null;
  const pressed = (on: boolean) => `${chipClass} ${on ? "border-tinta bg-tinta text-papel" : "border-current/25 bg-transparent text-tinta hover:border-current/50"}`;
  const legend = hasMenu
    ? solo ? "Tu menú y alergias" : "Menú y alergias de cada persona"
    : solo ? "Alergias o dieta (opcional)" : "Alergias o dieta de cada persona (opcional)";
  return (
    <fieldset className="sp-appear mt-7 border-0 p-0" data-rsvp-people="">
      <legend className={labelClass}>{legend}</legend>
      <p className="mt-1 text-sm leading-relaxed text-tinta/65">
        {hasMenu
          ? solo ? "Elige tu menú y marca lo que tengamos que saber." : "Elige el menú de cada uno y marca lo que tengamos que saber."
          : "Marca lo que tengamos que saber; si no hay nada, déjalo así."}
      </p>
      <ol className="m-0 mt-3 grid list-none gap-5 p-0">
        {people.map((person, index) => {
          const label = labels[index] ?? "";
          const update = (patch: Partial<PersonDiet>) => onChange(index, { ...person, ...patch });
          return (
            <li key={index} className="border-b border-current/15 pb-4" data-rsvp-person={index}>
              <p className="text-base font-medium text-tinta">{label}</p>
              {hasMenu && (
                <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={`Menú de ${label}`}>
                  {menuOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={person.menu === option.id}
                      onClick={() => update({ menu: person.menu === option.id ? null : option.id })}
                      className={pressed(person.menu === option.id)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={`Alergias o dieta de ${label}`}>
                {chips.map((chip) => {
                  const on = person.tags.includes(chip.id);
                  return (
                    <button key={chip.id} type="button" aria-pressed={on} onClick={() => onChange(index, toggleDietTag(person, chip.id))} className={pressed(on)}>
                      {chip.label}
                    </button>
                  );
                })}
                {showHealth && (
                  <button type="button" aria-pressed={person.otherOn} onClick={() => update({ otherOn: !person.otherOn })} className={pressed(person.otherOn)}>
                    Otra
                  </button>
                )}
              </div>
              {showHealth && person.otherOn && (
                <label className="mt-1 block">
                  <span className="sr-only">Otra alergia o intolerancia de {label}</span>
                  <input
                    value={person.other}
                    onChange={(event) => update({ other: event.target.value })}
                    onBlur={() => update({ other: cleanDietOther(person.other) })}
                    maxLength={DIET_OTHER_MAX}
                    autoComplete="off"
                    placeholder="¿Cuál? Por ejemplo, marisco"
                    className={inputClass}
                  />
                </label>
              )}
            </li>
          );
        })}
      </ol>
      {/* Aviso, no bloquea: el menú es opcional y se puede elegir más tarde. */}
      {menuHint && <p className="mt-2 text-sm text-tinta/65">{menuHint}</p>}
    </fieldset>
  );
}
