import type { GameSessionView } from "./gameSessionView";

export interface LocalProfileSummary {
  readonly profileId: string;
  readonly displayName: string;
}

export { normalizeProfileDisplayName } from "../shared/profileName";

export interface ProfileEntryError {
  readonly code: "BUSY" | "INVALID_NAME" | "PROFILE_EXISTS" | "PROFILE_NOT_FOUND" | "LOAD_FAILED";
  readonly message: string;
}

export type ProfileEntrySnapshot = Readonly<{
  status: "ready" | "working";
  profiles: readonly Readonly<LocalProfileSummary>[];
  error: Readonly<ProfileEntryError> | null;
}>;

export type ProfileEntryResult =
  | Readonly<{
      ok: true;
      profile: Readonly<LocalProfileSummary>;
      session: GameSessionView;
    }>
  | Readonly<{
      ok: false;
      error: Readonly<ProfileEntryError>;
    }>;

/** Local-only Profile entrance; no password or repository is exposed to the UI. */
export interface ProfileEntry {
  getSnapshot(): ProfileEntrySnapshot;
  subscribe(listener: () => void): () => void;
  enter(profileId: string): Promise<ProfileEntryResult>;
  register(displayName: string): Promise<ProfileEntryResult>;
}
