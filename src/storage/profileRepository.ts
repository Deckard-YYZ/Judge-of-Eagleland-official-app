import { z } from "zod";

import { normalizeProfileDisplayName } from "../shared/profileName";
import type { SqlDatabase } from "./schema";

const IdSchema = z.string().min(1);
const IsoDateTimeSchema = z.iso.datetime({ offset: true });
const ProfileRecordSchema = z.strictObject({
  profileId: IdSchema,
  loginName: IdSchema,
  displayName: IdSchema,
  createdAt: IsoDateTimeSchema,
});

export type ProfileRecord = z.infer<typeof ProfileRecordSchema>;

export interface ProfileRepository {
  list(): Promise<readonly ProfileRecord[]>;
  get(profileId: string): Promise<ProfileRecord | null>;
  findByLoginName(loginName: string): Promise<ProfileRecord | null>;
  create(profile: ProfileRecord): Promise<void>;
}

export type ProfileRepositoryErrorCode =
  | "INVALID_INPUT"
  | "INVALID_PROFILE"
  | "PROFILE_ALREADY_EXISTS";

export class ProfileRepositoryError extends Error {
  readonly code: ProfileRepositoryErrorCode;
  readonly cause?: unknown;

  constructor(code: ProfileRepositoryErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "ProfileRepositoryError";
    this.code = code;
    this.cause = cause;
  }
}

export const isProfileRepositoryError = (
  error: unknown,
): error is ProfileRepositoryError => error instanceof ProfileRepositoryError;

interface ProfileRow extends Record<string, unknown> {
  profile_id: string;
  login_name: string;
  display_name: string;
  created_at: string;
}

/**
 * Login names preserve case and compare case-sensitively. Whitespace is
 * normalized with the same rule as display names, and lookup uses this exact
 * function so registration and login cannot disagree about identity.
 */
export const normalizeProfileLoginName = (value: string): string =>
  typeof value === "string" ? normalizeProfileDisplayName(value) : value;

const parseProfile = (profile: unknown): ProfileRecord => {
  try {
    return ProfileRecordSchema.parse(profile);
  } catch (error) {
    throw new ProfileRepositoryError(
      "INVALID_PROFILE",
      "The supplied profile does not satisfy the storage contract.",
      error,
    );
  }
};

const validateProfileId = (profileId: string): string => {
  if (typeof profileId !== "string" || profileId.trim().length === 0) {
    throw new ProfileRepositoryError("INVALID_INPUT", "profileId must be a non-empty string.");
  }
  return profileId;
};

const validateLoginName = (loginName: string): string => {
  const normalized = normalizeProfileLoginName(loginName);
  if (normalized.length === 0) {
    throw new ProfileRepositoryError("INVALID_INPUT", "loginName must be a non-empty string.");
  }
  return normalized;
};

const rowToProfile = (row: ProfileRow): ProfileRecord =>
  parseProfile({
    profileId: row.profile_id,
    loginName: row.login_name,
    displayName: row.display_name,
    createdAt: row.created_at,
  });

/**
 * SQLite-backed local Profile repository. It deliberately has no delete or
 * authentication operation; a Profile is a local identity selected by the UI.
 */
export class SqliteProfileRepository implements ProfileRepository {
  constructor(private readonly database: SqlDatabase) {}

  async list(): Promise<readonly ProfileRecord[]> {
    const rows = await this.database.select<ProfileRow>(
      `SELECT profile_id, login_name, display_name, created_at
         FROM profiles
        ORDER BY created_at ASC, profile_id ASC`,
    );
    return rows.map(rowToProfile);
  }

  async get(profileId: string): Promise<ProfileRecord | null> {
    const id = validateProfileId(profileId);
    const rows = await this.database.select<ProfileRow>(
      `SELECT profile_id, login_name, display_name, created_at
         FROM profiles
        WHERE profile_id = $1`,
      [id],
    );
    const row = rows[0];
    return row ? rowToProfile(row) : null;
  }

  async findByLoginName(loginName: string): Promise<ProfileRecord | null> {
    const normalized = validateLoginName(loginName);
    const rows = await this.database.select<ProfileRow>(
      `SELECT profile_id, login_name, display_name, created_at
         FROM profiles
        WHERE login_name = $1`,
      [normalized],
    );
    const row = rows[0];
    return row ? rowToProfile(row) : null;
  }

  async create(profile: ProfileRecord): Promise<void> {
    const parsed = parseProfile({
      ...profile,
      loginName: normalizeProfileLoginName(profile.loginName),
      displayName: normalizeProfileDisplayName(profile.displayName),
    });

    // A no-op conflict is an unambiguous duplicate result. An IPC or database
    // exception is allowed through as-is because it may represent an unknown
    // write outcome and cannot safely be re-labelled as a duplicate.
    const result = await this.database.execute(
      `INSERT INTO profiles (profile_id, login_name, display_name, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [parsed.profileId, parsed.loginName, parsed.displayName, parsed.createdAt],
    );

    if (result.rowsAffected === 0) {
      throw new ProfileRepositoryError(
        "PROFILE_ALREADY_EXISTS",
        `A profile with id "${parsed.profileId}" or login name "${parsed.loginName}" already exists.`,
      );
    }
    if (result.rowsAffected !== 1) {
      throw new Error(`Profile insert affected ${result.rowsAffected} rows; expected exactly one.`);
    }
  }

}

export { ProfileRecordSchema };
