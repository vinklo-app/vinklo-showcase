import { describe, expect, it } from "vitest";
import { buildGoogleCalendarUrl, buildWeddingIcs, coupleInitials, icsDataUrl, icsFileName, isOptimizableImage, mapsUrl, weddingEventSpan } from "./format";

describe("coupleInitials", () => {
  it("usa grafemas completos (emoji, tildes) y mayúsculas", () => {
    expect(coupleInitials("María", "jorge")).toBe("M·J");
    expect(coupleInitials("🌿 Ana", "Íñigo")).toBe("🌿·Í");
    expect(coupleInitials("👩‍❤️‍👨 Pareja", "")).toBe("👩‍❤️‍👨");
    expect(coupleInitials("  ", "")).toBe("");
  });

  // Caracterización de `initialsOf` del creador (copia literal de la
  // implementación que vivía en onboarding-wizard.tsx antes de la Tarea 9).
  describe("lettersOnly + fallback (vista previa del creador)", () => {
    const legacyInitialsOf = (name1: string, name2: string) => {
      const first = (value: string) => {
        const graphemes = typeof Intl !== "undefined" && "Segmenter" in Intl
          ? Array.from(new Intl.Segmenter("es", { granularity: "grapheme" }).segment(value.trim()), (part) => part.segment)
          : Array.from(value.trim());
        return graphemes.find((grapheme) => /\p{L}/u.test(grapheme))?.toLocaleUpperCase("es") ?? "";
      };
      return [first(name1), first(name2)].filter(Boolean).join("·") || "V·S";
    };
    const creator = (a: string, b: string) => coupleInitials(a, b, { lettersOnly: true, fallback: "V·S" });
    const CASES: [string, string][] = [
      ["", ""], ["  ", " "], ["Marta", "Jorge"], ["💍 Marta", "Ólafur"], ["ólafur", "ñandú"], ["1984 Ana", "-Luis"],
      ["👩‍❤️‍👨 Pareja", ""], ["", "Íñigo"], ["!!!", "???"], ["Æsir", "ǅ"],
    ];
    it("salta emoji y signos, y cae a «V·S»", () => {
      expect(creator("💍 Marta", "Ólafur")).toBe("M·Ó");
      expect(creator("", "")).toBe("V·S");
      expect(creator("!!!", "")).toBe("V·S");
    });
    it("idéntico a la implementación original en todos los casos", () => {
      for (const [a, b] of CASES) expect(creator(a, b), JSON.stringify([a, b])).toBe(legacyInitialsOf(a, b));
    });
    it("sin opciones no cambia (el grafema, aunque sea emoji)", () => {
      expect(coupleInitials("💍 Marta", "")).toBe("💍");
    });
  });
});

describe("isOptimizableImage", () => {
  const sb = "https://abc.supabase.co";
  it("optimiza rutas propias y el bucket wedding-photos", () => {
    expect(isOptimizableImage("/muestras/pareja.jpg", sb)).toBe(true);
    expect(isOptimizableImage(`${sb}/storage/v1/object/public/wedding-photos/w/cover-1.jpg`, sb)).toBe(true);
  });
  it("no optimiza otras URL (legacy, blob:, protocolo relativo, sin env)", () => {
    expect(isOptimizableImage("https://example.com/foto.jpg", sb)).toBe(false);
    expect(isOptimizableImage(`${sb}/storage/v1/object/public/otro/x.jpg`, sb)).toBe(false);
    expect(isOptimizableImage("blob:http://localhost/abc", sb)).toBe(false);
    expect(isOptimizableImage("//evil.example/x.jpg", sb)).toBe(false);
    expect(isOptimizableImage(`${sb}/storage/v1/object/public/wedding-photos/x.jpg`, undefined)).toBe(false);
  });
});

describe("mapsUrl", () => {
  it("construye la búsqueda con lugar y dirección escritos por la pareja", () => {
    expect(mapsUrl("Finca La Alquería", "Camino de la Dehesa, 14")).toBe(
      "https://www.google.com/maps/search/?api=1&query=Finca%20La%20Alquer%C3%ADa%2C%20Camino%20de%20la%20Dehesa%2C%2014",
    );
  });
  it("una dirección https se usa tal cual; nada → null", () => {
    expect(mapsUrl("", "https://maps.app.goo.gl/x")).toBe("https://maps.app.goo.gl/x");
    expect(mapsUrl("", "")).toBeNull();
    expect(mapsUrl("", "http://inseguro")).toContain("google.com/maps/search");
  });
  it("con place_id de Google abre el sitio exacto (query_place_id); un id raro se ignora", () => {
    expect(mapsUrl("Finca La Alquería", "Toledo", "ChIJN1t_tDeuEmsRUsoyG83frY4")).toBe(
      "https://www.google.com/maps/search/?api=1&query=Finca%20La%20Alquer%C3%ADa%2C%20Toledo&query_place_id=ChIJN1t_tDeuEmsRUsoyG83frY4",
    );
    expect(mapsUrl("Finca", "", "a b&c=d")).toBe("https://www.google.com/maps/search/?api=1&query=Finca");
    // Un enlace https escrito por la pareja manda sobre el place_id.
    expect(mapsUrl("Finca", "https://maps.app.goo.gl/x", "ChIJN1t_tDeuEmsRUsoyG83frY4")).toBe("https://maps.app.goo.gl/x");
  });
});

describe("buildWeddingIcs", () => {
  it("hora de verano de Madrid → UTC (13:00 CEST = 11:00Z), fin a +8 h y aviso el día antes", () => {
    const ics = buildWeddingIcs({ partnerName1: "Lucía", partnerName2: "Juan", weddingDate: "2027-06-12", time: "13:00", venue: "Finca La Alquería", address: "Camino 14, Cercedilla" })!;
    expect(ics).toContain("DTSTART:20270612T110000Z");
    expect(ics).toContain("DTEND:20270612T190000Z");
    expect(ics).toContain("BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Mañana: Boda de Lucía y Juan\r\nTRIGGER:-P1D\r\nEND:VALARM");
    expect(ics).toContain("SUMMARY:Boda de Lucía y Juan");
    expect(ics).toContain("LOCATION:Finca La Alquería\\, Camino 14\\, Cercedilla");
    expect(ics).toContain("UID:lucia-y-juan-20270612@vinklo.es");
    expect(ics.split("\r\n")[0]).toBe("BEGIN:VCALENDAR");
  });
  it("hora de invierno (CET = UTC+1) y día del cambio de hora", () => {
    expect(buildWeddingIcs({ partnerName1: "A", partnerName2: "B", weddingDate: "2027-01-16", time: "18:30" })).toContain("DTSTART:20270116T173000Z");
    // 28-mar-2027: a las 12:00 ya es CEST.
    expect(buildWeddingIcs({ partnerName1: "A", partnerName2: "B", weddingDate: "2027-03-28", time: "12:00" })).toContain("DTSTART:20270328T100000Z");
  });
  it("sin hora → día completo; sin fecha → null; determinista", () => {
    const a = buildWeddingIcs({ partnerName1: "A", partnerName2: "B", weddingDate: "2027-09-04" });
    expect(a).toContain("DTSTART;VALUE=DATE:20270904");
    expect(a).toContain("DTEND;VALUE=DATE:20270905");
    expect(a).toContain("DTSTAMP:20270904T000000Z");
    expect(a).not.toContain("LOCATION");
    expect(buildWeddingIcs({ partnerName1: "A", partnerName2: "B", weddingDate: "2027-09-04" })).toBe(a);
    expect(buildWeddingIcs({ partnerName1: "A", partnerName2: "B", weddingDate: "" })).toBeNull();
  });
  it("el programa alarga el evento solo si acaba más tarde de +8 h (pasada la medianoche, día siguiente)", () => {
    const base = { partnerName1: "A", partnerName2: "B", weddingDate: "2027-06-12", time: "18:00" };
    // 18:00 CEST = 16:00Z; +8 h = 00:00Z del 13.
    expect(buildWeddingIcs({ ...base, programTimes: ["18:00", "21:00"] })).toContain("DTEND:20270613T000000Z");
    // Último momento a la 01:30 del día siguiente (23:30Z del 12) → sigue mandando +8 h.
    expect(buildWeddingIcs({ ...base, programTimes: ["18:00", "01:30"] })).toContain("DTEND:20270613T000000Z");
    // Recena a las 03:00 → 01:00Z del 13, más tarde que +8 h.
    expect(buildWeddingIcs({ ...base, programTimes: ["18:00", "A las 3 h"] })).toContain("DTEND:20270613T010000Z");
    expect(weddingEventSpan({ weddingDate: "2027-06-12", time: "" })).toBeNull();
  });
  it("DTSTAMP real cuando se pasa la hora de generación", () => {
    const ics = buildWeddingIcs({ partnerName1: "A", partnerName2: "B", weddingDate: "2027-09-04", stamp: new Date("2026-10-17T20:15:09Z") })!;
    expect(ics).toContain("DTSTAMP:20261017T201509Z");
  });
  it("una fecha imposible no genera evento", () => {
    expect(buildWeddingIcs({ partnerName1: "A", partnerName2: "B", weddingDate: "2027-02-30" })).toBeNull();
  });
  it("escapa ; , \\ y saltos de línea; pliega líneas largas", () => {
    const ics = buildWeddingIcs({ partnerName1: "A;B", partnerName2: "C\\D", weddingDate: "2027-09-04", venue: "x".repeat(120) })!;
    expect(ics).toContain("SUMMARY:Boda de A\\;B y C\\\\D");
    expect(ics.split("\r\n").every((l) => Array.from(l).length <= 75)).toBe(true);
  });
  it("data URL y nombre de archivo legibles", () => {
    expect(icsDataUrl("BEGIN:VCALENDAR")).toBe("data:text/calendar;charset=utf-8,BEGIN%3AVCALENDAR");
    expect(icsFileName("Lucía", "Juan")).toBe("boda-lucia-y-juan.ics");
    expect(icsFileName("محمد", "🌿")).toBe("boda-y.ics");
  });
});

describe("buildGoogleCalendarUrl", () => {
  const base = { partnerName1: "Lucía", partnerName2: "Juan" };
  it("con hora: hora de pared de Madrid, ctz y el mismo fin que el .ics (+8 h), con textos codificados", () => {
    const url = new URL(buildGoogleCalendarUrl({ ...base, weddingDate: "2027-06-12", time: "13:00", venue: "Finca La Alquería", address: "Camino 14, Cercedilla", url: "https://vinklo.es/b/x?a=1&b=2" })!);
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe("Boda de Lucía y Juan");
    expect(url.searchParams.get("dates")).toBe("20270612T130000/20270612T210000");
    expect(url.searchParams.get("ctz")).toBe("Europe/Madrid");
    expect(url.searchParams.get("location")).toBe("Finca La Alquería, Camino 14, Cercedilla");
    expect(url.searchParams.get("details")).toBe("https://vinklo.es/b/x?a=1&b=2");
    expect(url.search).toContain("text=Boda+de+Luc%C3%ADa+y+Juan");
  });
  it("la hora que cruza medianoche pasa al día siguiente", () => {
    expect(new URL(buildGoogleCalendarUrl({ ...base, weddingDate: "2027-12-31", time: "23:30" })!).searchParams.get("dates")).toBe("20271231T233000/20280101T073000");
  });
  it("sin hora: día completo con fin exclusivo y sin ctz", () => {
    const url = new URL(buildGoogleCalendarUrl({ ...base, weddingDate: "2027-02-28" })!);
    expect(url.searchParams.get("dates")).toBe("20270228/20270301");
    expect(url.searchParams.has("ctz")).toBe(false);
    expect(url.searchParams.has("location")).toBe(false);
  });
  it("sin fecha válida no hay enlace", () => {
    expect(buildGoogleCalendarUrl({ ...base, weddingDate: "" })).toBeNull();
    expect(buildGoogleCalendarUrl({ ...base, weddingDate: "12/06/2027" })).toBeNull();
  });
});
