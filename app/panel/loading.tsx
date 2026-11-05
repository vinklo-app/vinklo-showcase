import { PanelHomeSkeleton } from "@/components/panel/panel-skeleton";

/** Mientras llega el panel (plan maestro §4.4): la forma de la página, no un spinner. */
export default function PanelLoading() {
  return <PanelHomeSkeleton />;
}
