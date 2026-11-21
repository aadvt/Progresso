import type { ConstellationModel } from "@progresso/core/constellation/client";

/** What the orchestrator can ask of either renderer (3D scene or 2D map). */
export interface RendererApi {
  setModel(model: ConstellationModel): void;
  ripple(req: { roots: string[]; to: ConstellationModel }): void;
  select(id: string | null): void;
  showRoots(): void;
  overview(): void;
}
