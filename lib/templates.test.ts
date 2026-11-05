import { describe, expect, it } from "vitest";
import { DEMO_TEMPLATES } from "@/components/landing/demo-wedding";
import { BUILDER_TEMPLATES, findBuilderTemplate } from "./templates";

describe("plantillas", () => {
  it("busca por id y rechaza lo que no es una plantilla", () => {
    expect(findBuilderTemplate("hora-dorada")).toEqual({ id: "hora-dorada", name: "Hora dorada", themeId: "clasico", palette: "rosa" });
    expect(findBuilderTemplate("nope")).toBeUndefined();
    expect(findBuilderTemplate(undefined)).toBeUndefined();
    expect(findBuilderTemplate(["origen"])).toBeUndefined();
  });

  it("la demo deriva de la misma lista (mismos ids, nombres, estilos y paletas)", () => {
    expect(DEMO_TEMPLATES.map(({ id, name, themeId, palette }) => ({ id, name, themeId, palette }))).toEqual(BUILDER_TEMPLATES);
  });
});
