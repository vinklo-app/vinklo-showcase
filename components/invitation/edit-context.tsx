"use client";

/**
 * Marcas de «Seleccionar» para la maqueta «Como una web» (componentes
 * cliente): el renderer solo monta este proveedor con `editTargets` en
 * mode="preview". Sin proveedor (web pública, /demo) no hay marcas.
 */
import { createContext, useContext, type ReactNode } from "react";

interface EditTargets {
  on: boolean;
  /** id de la portada (rutas de la bienvenida y el titular pequeño). */
  coverId: string;
}

const EditTargetsContext = createContext<EditTargets>({ on: false, coverId: "" });

export function EditTargetsProvider({ coverId, children }: { coverId: string; children: ReactNode }) {
  return <EditTargetsContext.Provider value={{ on: true, coverId }}>{children}</EditTargetsContext.Provider>;
}

export function useEditTargets(): EditTargets {
  return useContext(EditTargetsContext);
}
