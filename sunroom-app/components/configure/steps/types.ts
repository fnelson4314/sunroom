import type { useConfigureState } from "@/hooks/useConfigureState";

// The shape every step component reads/writes against — configure.tsx keeps
// owning the hook instance; steps only receive it as a prop.
export type ConfigureApi = ReturnType<typeof useConfigureState>;
