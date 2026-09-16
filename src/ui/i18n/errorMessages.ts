import type { GameSessionErrorCode } from "../../application/gameSession";
import type { ProfileEntryError } from "../../application/profileEntry";
import type { MessageKey, Translate } from "./translator";

const sessionErrorKeys = {
  BUSY: "sessionError.BUSY",
  NOT_LOADED: "sessionError.NOT_LOADED",
  RELOAD_REQUIRED: "sessionError.RELOAD_REQUIRED",
  INVALID_COMMAND: "sessionError.INVALID_COMMAND",
  TRANSITION_ERROR: "sessionError.TRANSITION_ERROR",
  CLOCK_ERROR: "sessionError.CLOCK_ERROR",
  SAVE_NOT_FOUND: "sessionError.SAVE_NOT_FOUND",
  SAVE_LOAD_FAILED: "sessionError.SAVE_LOAD_FAILED",
  INVALID_SAVE: "sessionError.INVALID_SAVE",
  CONTENT_LOAD_FAILED: "sessionError.CONTENT_LOAD_FAILED",
  CONTENT_INVALID: "sessionError.CONTENT_INVALID",
  CONTENT_MISMATCH: "sessionError.CONTENT_MISMATCH",
  SAVE_FAILED: "sessionError.SAVE_FAILED",
  CASE_LOCKED: "sessionError.CASE_LOCKED",
  CASE_ALREADY_RESOLVED: "sessionError.CASE_ALREADY_RESOLVED",
  CASE_ALREADY_STARTED: "sessionError.CASE_ALREADY_STARTED",
  STALE_CHOICE: "sessionError.STALE_CHOICE",
  INVALID_CHOICE: "sessionError.INVALID_CHOICE",
  STORY_INPUT_REQUIRED: "sessionError.STORY_INPUT_REQUIRED",
  STALE_STORY_INPUT: "sessionError.STALE_STORY_INPUT",
  STORY_BLOCKING: "sessionError.STORY_BLOCKING",
  INVALID_STORY_COMPLETION: "sessionError.INVALID_STORY_COMPLETION",
  RUN_FINISHED: "sessionError.RUN_FINISHED",
  INVALID_INPUT: "sessionError.INVALID_INPUT",
  SAVE_ALREADY_EXISTS: "sessionError.SAVE_ALREADY_EXISTS",
  PROFILE_MISMATCH: "sessionError.PROFILE_MISMATCH",
  REVISION_CONFLICT: "sessionError.REVISION_CONFLICT",
} as const satisfies Record<GameSessionErrorCode, MessageKey>;

const profileErrorKeys = {
  BUSY: "profile.error.BUSY",
  INVALID_NAME: "profile.error.INVALID_NAME",
  PROFILE_EXISTS: "profile.error.PROFILE_EXISTS",
  PROFILE_NOT_FOUND: "profile.error.PROFILE_NOT_FOUND",
  LOAD_FAILED: "profile.error.LOAD_FAILED",
} as const satisfies Record<ProfileEntryError["code"], MessageKey>;

/** Error codes are stable facts; localized UI copy never depends on lower-layer messages. */
export const translateSessionError = (t: Translate, code: GameSessionErrorCode): string =>
  t(sessionErrorKeys[code]);

export const translateProfileError = (t: Translate, code: ProfileEntryError["code"]): string =>
  t(profileErrorKeys[code]);
