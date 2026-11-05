import { describe, expect, it } from "vitest";
import { excelTableName, excelTablesProposal } from "./excel-tables";
import { MAX_TABLES, type SeatGuest, type SeatingPlan } from "./seating";

const g = (id: string, rsvp_status: SeatGuest["rsvp_status"] = "si", companions = 0): SeatGuest => ({ id, name: `P${id}`, rsvp_status, companions, notes: null, group_name: null });

describe("excelTableName", () => {
  it("número → «Mesa N»; texto tal cual; vacío o largo → null", () => {
    expect(excelTableName("3")).toBe("Mesa 3");
    expect(excelTableName(" 12.0 ")).toBe("Mesa 12");
    expect(excelTableName("07")).toBe("Mesa 7");
    expect(excelTableName("  Mesa   de los primos ")).toBe("Mesa de los primos");
    expect(excelTableName("Presidencial")).toBe("Presidencial");
    expect(excelTableName("   ")).toBeNull();
    expect(excelTableName("x".repeat(41))).toBeNull();
  });
});

describe("excelTablesProposal", () => {
  const plan = (): SeatingPlan => ({
    tables: [{ id: "t-pres", name: "presidencial", seats: 8, position: 1, guests: [g("ya")] }],
    unseated: [g("a", "si", 3), g("b", "pendiente"), g("c", "no"), g("d"), g("e"), g("f", "si", 20)],
  });
  it("solo quien no tiene mesa y no dice que no; reutiliza mesas por nombre; orden natural", () => {
    const mesa = new Map([["a", "3"], ["b", "3.0"], ["c", "3"], ["d", "Presidencial"], ["e", "10"], ["ya", "3"], ["f", "2"]]);
    const result = excelTablesProposal(plan(), mesa)!;
    expect(result.created).toBe(3);
    expect(result.reused).toBe(1);
    expect(result.guests).toBe(5);
    expect(result.change.newTables).toEqual([
      { key: "new:1", name: "Mesa 2", seats: 21 },
      { key: "new:2", name: "Mesa 3", seats: 10 },
      { key: "new:3", name: "Mesa 10", seats: 10 },
    ]);
    expect(result.change.assignments).toEqual([
      { guestId: "f", tableId: "new:1" },
      { guestId: "a", tableId: "new:2" }, { guestId: "b", tableId: "new:2" },
      { guestId: "e", tableId: "new:3" },
      { guestId: "d", tableId: "t-pres" },
    ]);
  });
  it("las plazas de una mesa nueva van de 10 a 30", () => {
    const big = { tables: [], unseated: [g("x", "si", 10), g("y", "si", 10), g("z", "si", 10)] };
    expect(excelTablesProposal(big, new Map([["x", "1"], ["y", "1"], ["z", "1"]]))!.change.newTables[0].seats).toBe(30);
  });
  it("sin nadie que sentar o pasándose del tope de mesas → null", () => {
    expect(excelTablesProposal(plan(), new Map([["c", "3"], ["ya", "4"]]))).toBeNull();
    expect(excelTablesProposal(plan(), new Map())).toBeNull();
    const full: SeatingPlan = { tables: Array.from({ length: MAX_TABLES }, (_, i) => ({ id: `t${i}`, name: `Mesa ${i + 1}`, seats: 10, position: i, guests: [] })), unseated: [g("a")] };
    expect(excelTablesProposal(full, new Map([["a", "Nueva"]]))).toBeNull();
    expect(excelTablesProposal(full, new Map([["a", "4"]]))!.reused).toBe(1);
  });
});
