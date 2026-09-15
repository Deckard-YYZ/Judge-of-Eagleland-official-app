import type { SaveEnvelope } from "../game/model";
import {
  parseSaveEnvelopeForStorage,
  parseStoredSaveEnvelope,
  SaveRepositoryError,
  type SaveRepository,
} from "./saveRepository";

/** Explicit destination for an imported copy; existing saves are never overwritten. */
export interface SaveBackupDestination {
  saveId: string;
  profileId: string;
  importedAt: string;
}

/**
 * Export the committed repository snapshot, never a pending UI state. File picking
 * and writing belong to the caller; this helper needs no filesystem capability.
 */
export async function exportSaveBackup(
  repository: SaveRepository,
  saveId: string,
  profileId: string,
): Promise<string> {
  const save = await repository.load(saveId, profileId);
  if (!save) {
    throw new SaveRepositoryError("SAVE_NOT_FOUND", "No save is available for this profile.");
  }
  return JSON.stringify(parseSaveEnvelopeForStorage(save), null, 2);
}

/**
 * Validate/migrate a backup before creating an independent revision-zero copy.
 * create must reject duplicate IDs. Import neither deletes an existing save nor
 * changes a Profile's current-save setting; selecting the copy is a separate act.
 */
export async function importSaveBackup(
  repository: SaveRepository,
  json: string,
  destination: SaveBackupDestination,
): Promise<SaveEnvelope> {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new SaveRepositoryError("INVALID_SAVE", "The backup is not valid JSON.", error);
  }
  const source = parseStoredSaveEnvelope(value);
  const imported = parseSaveEnvelopeForStorage({
    ...source,
    saveId: destination.saveId,
    profileId: destination.profileId,
    revision: 0,
    updatedAt: destination.importedAt,
  });
  await repository.create(imported);
  return imported;
}
