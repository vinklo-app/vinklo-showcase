import { describe, expect, it } from "vitest";
import {
  EXTRA_BUDGET_BYTES, EXTRA_MAX_BYTES, EXTRA_MAX_KEYS, analyzeSheet, extraBytes, buildGuests, detectHeaderRow, extraKey, fieldForHeader, markGuestDuplicates,
  normalizePhone, parseAttendance, parseSide, readSummary, splitPeople, type RawSheet,
} from "./guest-excel-import";

const sheet = (rows: string[][], name = "Hoja1"): RawSheet => ({ name, rows });
const build = (rows: string[][], options?: Parameters<typeof buildGuests>[1]) => buildGuests([analyzeSheet(sheet(rows))], options);

describe("títulos de columna", () => {
  it("entiende sinónimos en español e inglés", () => {
    const cases: Array<[string, string]> = [
      ["Nombre", "name"], ["NOMBRE Y APELLIDOS", "name"], ["Invitado", "name"], ["Guest name", "name"],
      ["Apellidos", "surname"], ["Teléfono", "phone"], ["Móvil", "phone"], ["Tlf.", "phone"], ["WhatsApp", "phone"], ["Phone", "phone"],
      ["E-mail", "email"], ["Correo electrónico", "email"], ["¿Asiste?", "attendance"], ["Confirmado", "attendance"], ["RSVP", "attendance"],
      ["Acompañantes", "companions"], ["+1", "companions"], ["Plus ones", "companions"], ["Nº personas", "people"], ["Pax", "people"], ["Niños", "kids"],
      ["Nombre del acompañante", "companion_names"], ["Pareja", "companion_names"], ["Familia", "household"], ["Nº invitación", "household"],
      ["Grupo", "group"], ["Relación", "group"], ["Lado", "side"], ["De parte de", "side"], ["Etiquetas", "tags"],
      ["Alergias", "notes"], ["Intolerancias", "notes"], ["Dietary requirements", "notes"], ["Mesa", "table"], ["Menú", "menu"], ["Autobús", "bus"],
      // Por palabra clave (no exactos).
      ["Teléfono móvil del invitado", "phone"], ["Confirmación de asistencia", "attendance"], ["Alergias o intolerancias", "notes"], ["Mesa asignada", "table"],
    ];
    for (const [header, field] of cases) expect([header, fieldForHeader(header)]).toEqual([header, field]);
    expect(fieldForHeader("Color favorito")).toBeNull();
  });

  it("entiende las abreviaturas habituales de acompañantes", () => {
    for (const header of ["acomp", "Acomp.", "ACOMP", "acompañ", "Acompañ.", "Nº acomp", "nº acomp.", "Num. acomp", "+1", "+ 1", "plus one", "Plus One", "acomps"]) {
      expect([header, fieldForHeader(header)]).toEqual([header, "companions"]);
    }
    // Por palabra clave, también con más texto alrededor; y con «nombre», son los nombres.
    expect(fieldForHeader("acomp. confirmados")).toBe("companions");
    expect(fieldForHeader("Nombres acomp.")).toBe("companion_names");
    // La hoja de la landing «Del Excel a WhatsApp» (antes «acomp» iba a campo propio).
    const analyzed = analyzeSheet(sheet([["NOMBRE Y APELLIDOS", "Tlf.", "acomp", "¿mesa?", "Alergias / obs.", "de quién"], ["Marta López Ruiz", "600 000 101", "1", "4", "", "Novia"]]));
    expect(analyzed.mapping[2]).toBe("companions");
    // Notas generales y «Contacto» no tienen campo por el título: notas → campo propio; contacto → por sus valores.
    for (const header of ["Notas", "Observaciones", "Comentarios", "Contacto"]) expect([header, fieldForHeader(header)]).toEqual([header, null]);
  });

  it("encuentra la fila de títulos aunque no sea la primera, y sabe cuándo no hay", () => {
    expect(detectHeaderRow([["Boda de Lucía y Juan"], [], ["Lista de invitados"], ["Nombre", "Teléfono", "Mesa"], ["Ana", "612345678", "3"]])).toBe(3);
    expect(detectHeaderRow([["Marta Díaz", "612345678", "sí"], ["Juan Pérez", "699887766", "no"]])).toBe(-1);
    // «Familia Pérez» o «Lista de invitados» solos no son títulos.
    expect(detectHeaderRow([["Familia Pérez"], ["Ana López"]])).toBe(-1);
    expect(detectHeaderRow([["Invitado principal", "Contacto móvil", "Observaciones varias"], ["Ana", "612345678", "—"]])).toBe(0);
  });
});

describe("valores", () => {
  it("normaliza teléfonos españoles con +34, 0034, espacios, puntos y guiones", () => {
    expect(normalizePhone("+34 612 34 56 78").phone).toBe("+34 612 345 678");
    expect(normalizePhone("0034612345678").phone).toBe("+34 612 345 678");
    expect(normalizePhone("34612345678").phone).toBe("+34 612 345 678");
    expect(normalizePhone("612-345-678").phone).toBe("612 345 678");
    expect(normalizePhone("612.345.678").phone).toBe("612 345 678");
    expect(normalizePhone("612345678").phone).toBe("612 345 678");
    expect(normalizePhone("91 555 66 77").phone).toBe("915 556 677");
    expect(normalizePhone("+44 7700 900123").phone).toBe("+44 7700 900123");
    expect(normalizePhone("612345678 / 699887766")).toEqual({ phone: "612 345 678", valid: true, others: ["699887766"] });
    expect(normalizePhone("")).toEqual({ phone: null, valid: true, others: [] });
    expect(normalizePhone("12345").valid).toBe(false);
    expect(normalizePhone("llamar a su madre").valid).toBe(false);
    expect(normalizePhone("5551234").valid).toBe(false);
  });

  it("asistencia: sí / no / pendiente; lo que no se entiende, null", () => {
    for (const yes of ["Sí", "si", "SI", "x", "✓", "OK", "Confirmado", "confirmada", "asiste", "1", "TRUE", "Sí, con niños"]) expect([yes, parseAttendance(yes)]).toEqual([yes, "si"]);
    for (const no of ["No", "no viene", "Declina", "0", "✗", "FALSE"]) expect([no, parseAttendance(no)]).toEqual([no, "no"]);
    for (const pending of ["", "Pendiente", "?", "quizás", "sin respuesta"]) expect([pending, parseAttendance(pending)]).toEqual([pending, "pendiente"]);
    expect(parseAttendance("Llega tarde")).toBeNull();
  });

  it("parejas en una celda", () => {
    expect(splitPeople("Ana y Pablo")).toEqual({ lead: "Ana", companions: ["Pablo"], unnamed: 0 });
    expect(splitPeople("Ana & Pablo García")).toEqual({ lead: "Ana", companions: ["Pablo García"], unnamed: 0 });
    expect(splitPeople("Ana, Pablo y Lucía")).toEqual({ lead: "Ana", companions: ["Pablo", "Lucía"], unnamed: 0 });
    expect(splitPeople("Tía Puri +1")).toEqual({ lead: "Tía Puri", companions: [], unnamed: 1 });
    expect(splitPeople("Hugo (+2)")).toEqual({ lead: "Hugo", companions: [], unnamed: 2 });
    expect(splitPeople("Carlos y acompañante")).toEqual({ lead: "Carlos", companions: [], unnamed: 1 });
    expect(splitPeople("Familia García")).toEqual({ lead: "Familia García", companions: [], unnamed: 0 });
    expect(splitPeople("Juan Pérez y Hnos. Distribuciones del Norte S.L.").companions).toEqual([]);
  });

  it("lado con los nombres de la pareja", () => {
    const partners = { p1: "Lucía Gómez", p2: "Juan" };
    expect(parseSide("Lucía", partners)).toBe("p1");
    expect(parseSide("De Juan", partners)).toBe("p2");
    expect(parseSide("Ambos", partners)).toBe("ambos");
    expect(parseSide("", partners)).toBe("none");
    expect(parseSide("Novio", partners)).toBeNull();
  });

  it("claves de campos propios seguras", () => {
    expect(extraKey("__proto__")).not.toBe("__proto__");
    expect(extraKey("  Dirección   postal ")).toBe("Dirección postal");
    expect(extraKey("x".repeat(60))).toHaveLength(40);
  });
});

describe("Excel típico de una pareja", () => {
  const rows = [
    ["Boda Lucía & Juan · 2026"],
    [],
    ["Nombre", "Apellidos", "Teléfono", "Email", "¿Asiste?", "Acompañantes", "Mesa", "Menú", "Alergias", "Grupo", "Color favorito", "Nº"],
    ["Ana y Pablo", "García", "+34 612 34 56 78", "ana@ejemplo.es", "Sí", "1", "3", "Carne", "", "Uni", "Azul", "1"],
    ["Tío Ramón", "", "0034 699 887 766", "", "", "2", "", "", "Celíaco", "Familia Juan", "", "2"],
    ["Marta", "Díaz", "12345", "", "no", "", "", "", "", "", "Verde", "3"],
    ["", "", "", "", "", "", "", "", "", "", "", ""],
    ["", "", "611222333", "", "", "", "", "", "", "", "", "4"],
  ];

  it("propone el mapeo y lee filas, invitaciones y personas", () => {
    const analysis = analyzeSheet(sheet(rows));
    expect(analysis.headerRow).toBe(2);
    expect(analysis.mapping).toEqual(["name", "surname", "phone", "email", "attendance", "companions", "table", "menu", "notes", "group", "custom", "ignore"]);
    const result = buildGuests([analysis]);
    expect(result.rows).toBe(4);
    expect(result.guests).toHaveLength(3);
    expect(result.people).toBe(2 + 3 + 1);
    expect(readSummary({ rows: result.rows, guests: result.guests.length, people: result.people })).toBe("Hemos leído 4 filas: 3 invitaciones y 6 personas");
  });

  it("«Ana y Pablo» + apellidos = una invitación con acompañante; nada se pierde", () => {
    const [ana, ramon, marta] = build(rows).guests;
    expect(ana).toMatchObject({
      name: "Ana García", phone: "+34 612 345 678", status: "si", companions: 1, max_companions: 1, group: "Uni",
      companion_names: ["Pablo García"], extra: { Email: "ana@ejemplo.es", Mesa: "3", "Menú": "Carne", "Color favorito": "Azul" },
    });
    expect(ramon).toMatchObject({ name: "Tío Ramón", phone: "+34 699 887 766", status: "pendiente", companions: 2, max_companions: 2, notes: "Celíaco", group: "Familia Juan" });
    // Teléfono raro: fuera del campo teléfono, guardado aparte y con aviso.
    expect(marta).toMatchObject({ name: "Marta Díaz", phone: null, status: "no", max_companions: null, extra: { "Teléfono (revisar)": "12345", "Color favorito": "Verde" } });
  });

  it("avisa de teléfonos raros y de filas sin nombre", () => {
    const { warnings } = build(rows);
    expect(warnings.map((w) => w.kind).sort()).toEqual(["no_name", "phone"]);
    expect(warnings.find((w) => w.kind === "phone")?.text).toContain("12345");
  });
});

describe("otros formatos", () => {
  it("en inglés, con columnas de recuento", () => {
    const result = build([
      ["Guest name", "Phone", "RSVP", "Party size", "Table", "Dietary requirements"],
      ["John Smith", "+44 7700 900123", "yes", "3", "1", "Vegan"],
      ["Emma Brown", "", "no", "1", "", ""],
    ]);
    expect(result.guests.map((g) => [g.name, g.status, g.companions, g.notes, g.extra.Mesa ?? null])).toEqual([
      ["John Smith", "si", 2, "Vegan", "1"],
      ["Emma Brown", "no", 0, null, null],
    ]);
    expect(result.people).toBe(4);
  });

  it("sin fila de títulos: deduce por el aspecto de los valores", () => {
    const analysis = analyzeSheet(sheet([
      ["Marta Díaz", "612 345 678", "sí", "2", "marta@ejemplo.es"],
      ["Juan Pérez", "699887766", "no", "0", "juan@ejemplo.es"],
      ["Elena Ruiz", "+34 655 444 333", "", "1", ""],
    ]));
    expect(analysis.headerRow).toBe(-1);
    expect(analysis.mapping).toEqual(["name", "phone", "attendance", "companions", "email"]);
    expect(analysis.columns[0].header).toBe("Columna A");
    const result = buildGuests([analysis]);
    expect(result.guests).toHaveLength(3);
    expect(result.guests[0]).toMatchObject({ name: "Marta Díaz", phone: "612 345 678", status: "si", companions: 2, extra: { Email: "marta@ejemplo.es" } });
  });

  it("una columna de familia compartida = una invitación con acompañantes", () => {
    const result = build([
      ["Familia", "Nombre", "Teléfono", "Menú"],
      ["García", "Ana García", "612345678", "Carne"],
      ["García", "Pablo García", "699887766", "Pescado"],
      ["García", "Leo García", "", "Carne"],
      ["López", "Marta López", "655444333", ""],
    ]);
    expect(result.rows).toBe(4);
    expect(result.guests).toHaveLength(2);
    expect(result.guests[0]).toMatchObject({
      name: "Ana García", phone: "612 345 678", companions: 2, group: "García",
      companion_names: ["Pablo García", "Leo García"],
    });
    // Los datos de los acompañantes se conservan con su nombre delante.
    // (lo que comparten con la titular no se repite).
    expect(result.guests[0].extra["Menú"]).toBe("Carne · Pablo García: Pescado");
    expect(result.guests[0].extra["Otros teléfonos"]).toBe("Pablo García: 699 887 766");
    expect(result.people).toBe(4);
  });

  it("una «familia» de más de 11 personas no es una invitación: pasa a grupo", () => {
    const rows = [["Familia", "Nombre"], ...Array.from({ length: 14 }, (_, i) => ["Novia", `Prima ${String.fromCharCode(65 + i)}`])];
    const result = build(rows);
    expect(result.guests).toHaveLength(14);
    expect(result.guests.every((g) => g.group === "Novia" && g.companions === 0)).toBe(true);
    expect(result.warnings.some((w) => w.kind === "household_split")).toBe(true);
  });

  it("lado, etiquetas y columnas raras (incluida __proto__)", () => {
    const result = build([
      ["Nombre", "Lado", "Etiquetas", "__proto__", "Dirección"],
      ["Ana", "Lucía", "Uni, Pádel", "x", "Calle Mayor 1"],
      ["Leo", "Novio", "", "", ""],
    ], { partners: { p1: "Lucía", p2: "Juan" } });
    const [ana, leo] = result.guests;
    expect(ana.side).toBe("p1");
    expect(ana.tags).toEqual(["Uni", "Pádel"]);
    expect(Object.getPrototypeOf(ana.extra)).toBe(Object.prototype);
    expect(Object.keys(ana.extra)).toContain("Dirección");
    expect(JSON.parse(JSON.stringify(ana.extra))).toEqual(ana.extra);
    // «Novio» no se sabe de quién es: se queda como campo propio.
    expect(leo).toMatchObject({ side: null, extra: { Lado: "Novio" } });
  });

  it("respeta los topes de campos propios, trocea valores largos y avisa de lo que no cabe", () => {
    const headers = ["Nombre", ...Array.from({ length: 30 }, (_, i) => `Dato ${i + 1}`)];
    const row = ["Ana", ...Array.from({ length: 30 }, () => "valor")];
    row[1] = "y".repeat(400);
    const result = build([headers, row]);
    expect(Object.keys(result.guests[0].extra)).toHaveLength(EXTRA_MAX_KEYS);
    expect(result.guests[0].extra["Dato 1"]).toHaveLength(300);
    expect(result.guests[0].extra["Dato 1 (2)"]).toHaveLength(100);
    expect(result.warnings.map((w) => w.kind)).toContain("extra_full");
  });

  it("varias hojas: el nombre de la hoja hace de grupo si la fila no trae uno", () => {
    const a = analyzeSheet(sheet([["Nombre"], ["Ana"]], "Amigos"));
    const b = analyzeSheet(sheet([["Nombre", "Grupo"], ["Leo", "Primos"]], "Familia"));
    const result = buildGuests([a, b], { sheetAsGroup: true });
    expect(result.guests.map((g) => [g.name, g.group])).toEqual([["Ana", "Amigos"], ["Leo", "Primos"]]);
  });

  it("marca repetidos contra la lista guardada y dentro del archivo", () => {
    const { guests } = build([["Nombre", "Teléfono"], ["Ana García", "612345678"], ["Leo", ""], ["leo", ""]]);
    const marks = markGuestDuplicates(guests, [{ name: "Otra persona", phone: "+34 612 345 678" }]);
    expect(marks.map((m) => m && `${m.kind}:${m.by}`)).toEqual(["existing:phone", null, "batch:name"]);
  });
});

// Casos de la revisión (task-1-review.md, «Required before merge»).
describe("casos de la revisión", () => {
  it("«No confirmado», «No sabe», «No contesta» = pendiente; solo las negativas claras son «no»", () => {
    for (const pending of ["No confirmado", "no confirmada", "No sabe", "No contesta", "no ha respondido", "No han contestado"]) expect([pending, parseAttendance(pending)]).toEqual([pending, "pendiente"]);
    for (const no of ["No", "No viene", "no pueden", "NO ASISTE"]) expect([no, parseAttendance(no)]).toEqual([no, "no"]);
    expect(parseAttendance("No sé si con niños")).toBeNull();
    const result = build([["Nombre", "Asistencia"], ["Ana", "No confirmado"], ["Leo", "No viene"], ["Eva", "No lo tengo claro"]]);
    expect(result.guests.map((g) => [g.name, g.status])).toEqual([["Ana", "pendiente"], ["Leo", "no"], ["Eva", "pendiente"]]);
    // Lo que no se entiende se guarda y se avisa.
    expect(result.guests[2].extra.Asistencia).toBe("No lo tengo claro");
    expect(result.warnings.some((w) => w.kind === "attendance" && w.text.includes("Fila 4"))).toBe(true);
  });

  it("«Contacto» con teléfonos o emails no se mezcla con el nombre", () => {
    const phones = analyzeSheet(sheet([["Nombre", "Contacto", "Asistencia"], ["Ana García", "612345678", "sí"], ["Luis Pérez", "699887766", "no"]]));
    expect(phones.mapping).toEqual(["name", "phone", "attendance"]);
    expect(buildGuests([phones]).guests.map((g) => [g.name, g.phone])).toEqual([["Ana García", "612 345 678"], ["Luis Pérez", "699 887 766"]]);
    const emails = analyzeSheet(sheet([["Nombre", "Contacto"], ["Ana García", "ana@x.com"], ["Luis Pérez", "luis@x.com"]]));
    expect(emails.mapping).toEqual(["name", "email"]);
    expect(buildGuests([emails]).guests[1]).toMatchObject({ name: "Luis Pérez", extra: { Email: "luis@x.com" } });
    // Un título de nombre cuyos valores son teléfonos: mandan los valores.
    expect(analyzeSheet(sheet([["Nombre", "Persona"], ["Ana", "612345678"], ["Leo", "699887766"]])).mapping).toEqual(["name", "phone"]);
    // Dos columnas de nombre: la que más parece de nombres.
    expect(analyzeSheet(sheet([["Invitado", "Nombre"], ["Pase VIP 1", "Ana"], ["Pase VIP 2", "Leo"]])).mapping).toEqual(["custom", "name"]);
  });

  it("sin títulos y con «Familia» como dato: no se toma una fila de datos por títulos ni se pierde nadie", () => {
    const rows = [["Ana García", "Amigos", "Novia"], ["Luis Pérez", "Familia", "Novio"], ["Eva Ruiz", "Trabajo", "Novia"]];
    expect(detectHeaderRow(rows)).toBe(-1);
    const result = build(rows);
    expect(result.guests.map((g) => g.name)).toEqual(["Ana García", "Luis Pérez", "Eva Ruiz"]);
    expect(result.guests[1].extra).toMatchObject({ "Columna B": "Familia", "Columna C": "Novio" });
    // Con «Mesa» / «Menú» como dato, igual.
    expect(detectHeaderRow([["Ana", "Mesa", "Menú"], ["Leo", "Mesa", "Menú"]])).toBe(-1);
    // Filas con datos por encima de los títulos: aviso, nunca en silencio.
    const above = build([["Ana", "612345678"], ["Nombre", "Teléfono"], ["Leo", "699887766"]]);
    expect(above.guests.map((g) => g.name)).toEqual(["Leo"]);
    expect(above.warnings.find((w) => w.kind === "above_header")?.text).toContain("1");
  });

  it("familia con respuestas distintas: quien no viene no cuenta como acompañante y se conserva", () => {
    const result = build([
      ["Familia", "Nombre", "Asiste", "Grupo"],
      ["García", "Juan García", "Sí", "Primos"],
      ["García", "María García", "No", "Primos"],
      ["García", "Pablo García", "Sí", "Uni"],
    ]);
    expect(result.guests).toHaveLength(1);
    expect(result.guests[0]).toMatchObject({ name: "Juan García", status: "si", companions: 1, companion_names: ["Pablo García"], group: "Primos" });
    expect(result.guests[0].extra).toMatchObject({ "No vienen": "María García", Grupo: "Pablo García: Uni", "Invitación": "García" });
    expect(result.people).toBe(2);
    expect(result.warnings.some((w) => w.kind === "household_status")).toBe(true);
  });

  it("adultos + niños: se suman y el nº de niños se conserva; «Personas» ya incluye a los niños", () => {
    const adults = build([["Nombre", "Adultos", "Niños"], ["Ana", "2", "2"]]).guests[0];
    expect(adults).toMatchObject({ companions: 3, max_companions: 3, extra: { "Niños": "2", Adultos: "2" } });
    const total = build([["Nombre", "Personas", "Niños"], ["Ana", "4", "2"]]).guests[0];
    expect(total).toMatchObject({ companions: 3, extra: { "Niños": "2", Personas: "4" } });
    const withCompanions = build([["Nombre", "Acompañantes", "Niños"], ["Ana", "1", "2"]]).guests[0];
    expect(withCompanions).toMatchObject({ companions: 3, extra: { "Niños": "2" } });
  });

  it("«Observaciones» va a un campo propio; «Alergias» a la nota del invitado", () => {
    const [guest] = build([["Nombre", "Observaciones", "Alergias"], ["Ana", "Viene desde Sevilla, hotel X", "Celíaca"]]).guests;
    expect(guest.notes).toBe("Celíaca");
    expect(guest.extra.Observaciones).toBe("Viene desde Sevilla, hotel X");
  });

  it("una nota de 700 caracteres: 500 en la nota y el resto aparte, sin perder nada", () => {
    const long = Array.from({ length: 70 }, (_, i) => `alergia${String(i).padStart(2, "0")}`).join(" ").slice(0, 700);
    const [guest] = build([["Nombre", "Alergias"], ["Ana", long]]).guests;
    expect(guest.notes!.length).toBeLessThanOrEqual(500);
    expect(guest.notes!.length).toBeGreaterThan(440);
    expect(`${guest.notes} ${guest.extra["Más notas"]}`).toBe(long.trim());
  });

  it("25 campos propios al límite: caben en el presupuesto compacto y en el CHECK de Postgres (con espacios)", () => {
    const headers = ["Nombre", ...Array.from({ length: 25 }, (_, i) => `Campo propio ${String(i + 1).padStart(2, "0")}`)];
    const row = ["Ana", ...Array.from({ length: 25 }, () => "ñ".repeat(150))];
    const { guests, warnings } = build([headers, row]);
    const extra = guests[0].extra;
    const compact = extraBytes(extra);
    // Postgres guarda {"a": "b", "c": "d"}: un espacio tras cada «:» y cada «,».
    const keys = Object.keys(extra).length;
    const pgText = compact + keys + Math.max(0, keys - 1);
    expect(compact).toBeLessThanOrEqual(EXTRA_BUDGET_BYTES);
    expect(pgText).toBeLessThanOrEqual(EXTRA_MAX_BYTES);
    // Lo que no cabe se avisa (nunca en silencio).
    if (keys < 25) expect(warnings.some((w) => w.kind === "extra_full")).toBe(true);
  });

  it("«García, Ana» es una persona; «Ana, Pablo y Lucía» son tres", () => {
    expect(splitPeople("García, Ana")).toEqual({ lead: "Ana García", companions: [], unnamed: 0 });
    expect(splitPeople("Ana, Pablo y Lucía")).toEqual({ lead: "Ana", companions: ["Pablo", "Lucía"], unnamed: 0 });
    expect(splitPeople("Ana, Pablo, Lucía")).toEqual({ lead: "Ana", companions: ["Pablo", "Lucía"], unnamed: 0 });
  });

  it("cada invitación sabe su hoja y fila del archivo", () => {
    const result = build([["Boda"], [], ["Nombre"], ["Ana"], [], ["Leo"]]);
    expect(result.origins).toEqual([{ sheet: "Hoja1", line: 4 }, { sheet: "Hoja1", line: 6 }]);
  });
});


describe("regresión: apellidos explícitos con nombres compuestos", () => {
  it("conserva apellidos de titulares y acompañantes y evita duplicar un sufijo completo", () => {
    const result = build([
      ["Nombre", "Apellidos"],
      ["Juan Carlos", "García Pérez"],
      ["María José", "López Ruiz"],
      ["Ana María y José Luis", "Del Río"],
      ["Marta López Ruiz", "López Ruiz"],
      ["Pablo Ruiz", "Ruiz Pérez"],
    ]);
    expect(result.guests.map((guest) => guest.name)).toEqual([
      "Juan Carlos García Pérez", "María José López Ruiz", "Ana María Del Río", "Marta López Ruiz", "Pablo Ruiz Ruiz Pérez",
    ]);
    expect(result.guests[2].companion_names).toEqual(["José Luis Del Río"]);
  });
});
