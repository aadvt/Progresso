import type { ConstellationModel } from "@progresso/core/constellation/client";
import { ConstellationView } from "@/components/constellation/ConstellationView";
import { Surface } from "@/components/ui/Surface";
import styles from "./ConstellationSlot.module.css";

/**
 * The diagnosis page's window onto the knowledge constellation: a live,
 * slowly turning preview. Tapping it (or "Open the map") opens the full map.
 */
export function ConstellationSlot({ model, fullHref }: { model: ConstellationModel; fullHref: string }) {
  return (
    <Surface as="section" level={2} pad="none" className={styles.slot} data-slot="constellation" aria-labelledby="constellation-title">
      <ConstellationView model={model} variant="embedded" fullHref={fullHref} />
    </Surface>
  );
}
