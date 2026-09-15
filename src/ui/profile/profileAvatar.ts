export const MAX_PROFILE_AVATAR_BYTES = 5 * 1024 * 1024;

export interface ProfileAvatarFileLike {
  readonly type: string;
  readonly size: number;
}

export type ProfileAvatarValidationError = "invalidType" | "tooLarge";

export const profileInitial = (displayName: string, fallbackInitial: string): string =>
  Array.from(displayName.trim())[0]?.toLocaleUpperCase() ?? fallbackInitial;

export const validateProfileAvatar = (
  file: ProfileAvatarFileLike,
): ProfileAvatarValidationError | null => {
  if (!file.type.toLocaleLowerCase().startsWith("image/")) {
    return "invalidType";
  }

  if (file.size > MAX_PROFILE_AVATAR_BYTES) {
    return "tooLarge";
  }

  return null;
};
