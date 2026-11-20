import { create } from "zustand";
import { parseProductionDocument, type ProductionDocument } from "./lib/production/document";

interface ProductionStore {
  readonly document: ProductionDocument | null;
  readonly revision: number;
  readonly projectEpoch: number;
  readonly install: (input: unknown) => void;
  readonly clear: () => void;
}

export const useProductionStore = create<ProductionStore>()(set => ({
  document: null,
  revision: 0,
  projectEpoch: 0,
  install: input => {
    const document = parseProductionDocument(input);
    set(state => ({ document, revision: state.revision + 1 }));
  },
  clear: () => set(state => ({ document: null, revision: state.revision + 1, projectEpoch: state.projectEpoch + 1 })),
}));
