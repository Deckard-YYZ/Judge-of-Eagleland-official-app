import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import type { GameSessionView } from "../../application/gameSessionView";
import type { LocalProfileSummary, ProfileEntry } from "../../application/profileEntry";
import { normalizeProfileDisplayName } from "../../application/profileEntry";
import { LocaleSwitch } from "../LocaleSwitch";
import { ThemeSwitch } from "../ThemeSwitch";
import { translateProfileError, useI18n, type MessageKey } from "../i18n";
import type { UiThemeMode } from "../theme";
import {
  profileInitial,
  validateProfileAvatar,
  type ProfileAvatarValidationError,
} from "./profileAvatar";

const avatarErrorKeys = {
  invalidType: "profile.avatarInvalidType",
  tooLarge: "profile.avatarTooLarge",
} as const satisfies Record<ProfileAvatarValidationError, MessageKey>;

export interface ProfilePageProps {
  entry: ProfileEntry;
  themeMode: UiThemeMode;
  profileAvatarUrls: Readonly<Record<string, string>>;
  onThemeChange(mode: UiThemeMode): void;
  onAuthenticated(
    profile: Readonly<LocalProfileSummary>,
    session: GameSessionView,
    avatarFile?: File,
  ): void;
}

export function ProfilePage({
  entry,
  themeMode,
  profileAvatarUrls,
  onThemeChange,
  onAuthenticated,
}: ProfilePageProps) {
  const { t } = useI18n();
  const snapshot = useSyncExternalStore(entry.subscribe, entry.getSnapshot);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<ProfileAvatarValidationError | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const captureInputRef = useRef<HTMLInputElement>(null);
  const working = snapshot.status === "working";
  const normalizedName = normalizeProfileDisplayName(displayName);

  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(avatarFile);
    setAvatarPreviewUrl(objectUrl);
    return () => {
      // Preview URLs are UI-only resources. Revoke on replacement or unmount so
      // local image blobs do not outlive the registration surface that owns them.
      URL.revokeObjectURL(objectUrl);
    };
  }, [avatarFile]);

  const finish = (
    result: Awaited<ReturnType<ProfileEntry["enter"]>>,
    registeredAvatar?: File,
  ): void => {
    if (result.ok) {
      onAuthenticated(result.profile, result.session, registeredAvatar);
    }
  };

  const handleAvatarFile = (input: HTMLInputElement): void => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) {
      return;
    }

    const error = validateProfileAvatar(file);
    if (error) {
      setAvatarError(error);
      return;
    }

    setAvatarError(null);
    setAvatarFile(file);
  };

  const returnToLogin = (): void => {
    setMode("login");
    setDisplayName("");
    setAvatarFile(null);
    setAvatarError(null);
  };

  async function enterProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProfileId || working) {
      return;
    }
    finish(await entry.enter(selectedProfileId));
  }

  async function registerProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!normalizedName || working) {
      return;
    }
    finish(await entry.register(displayName), avatarFile ?? undefined);
  }

  return (
    <main className="profile-page">
      <section className="profile-intro" aria-labelledby="product-title">
        <div className="profile-intro__topbar">
          <div className="wordmark">
            <span className="wordmark__seal" aria-hidden="true">
              {t("brand.seal")}
            </span>
            <span>
              <strong>{t("brand.name")}</strong>
              <small>{t("brand.office")}</small>
            </span>
          </div>
          <div className="ui-preferences">
            <LocaleSwitch />
            <ThemeSwitch mode={themeMode} onChange={onThemeChange} />
          </div>
        </div>

        <div className="profile-intro__copy">
          <p className="kicker">{t("profile.introKicker")}</p>
          <h1 id="product-title">{t("profile.introTitle")}</h1>
          <p>{t("profile.introDescription")}</p>
        </div>

        <p className="profile-intro__folio" aria-hidden="true">
          {t("profile.folio")}
        </p>
      </section>

      <section className="profile-access" aria-labelledby="access-title">
        <div className="profile-access__content">
          <div className="profile-access__header">
            <p className="kicker">{t("profile.accessKicker")}</p>
            <h2 id="access-title">
              {t(mode === "login" ? "profile.entryTitle" : "profile.createTitle")}
            </h2>
            <p>{t("profile.memoryNotice")}</p>
          </div>

          <div className="profile-access__stage" key={mode}>
            {mode === "login" ? (
              <form className="profile-form profile-form--login" onSubmit={enterProfile}>
                <fieldset disabled={working || snapshot.profiles.length === 0}>
                  <legend>{t("profile.existingLegend")}</legend>
                  <ul className="profile-picker" aria-label={t("profile.listLabel")}>
                    {snapshot.profiles.map((profile) => {
                      const selected = selectedProfileId === profile.profileId;
                      const avatarUrl = profileAvatarUrls[profile.profileId];
                      return (
                        <li key={profile.profileId}>
                          <button
                            className="profile-choice"
                            type="button"
                            aria-pressed={selected}
                            aria-label={t("profile.selectAria", {
                              displayName: profile.displayName,
                            })}
                            onClick={() => setSelectedProfileId(profile.profileId)}
                          >
                            <span className="profile-avatar" aria-hidden="true">
                              {avatarUrl ? (
                                <img src={avatarUrl} alt="" />
                              ) : (
                                profileInitial(
                                  profile.displayName,
                                  t("profile.avatarFallbackInitial"),
                                )
                              )}
                            </span>
                            <span className="profile-choice__name">{profile.displayName}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>

                <div className="profile-actions">
                  <button
                    className="button button--primary"
                    type="submit"
                    disabled={!selectedProfileId || working}
                  >
                    {t("profile.login")}
                  </button>
                  <button
                    className="button button--secondary"
                    type="button"
                    disabled={working}
                    onClick={() => setMode("register")}
                  >
                    {t("profile.register")}
                  </button>
                </div>
              </form>
            ) : (
              <form className="profile-form profile-form--register" onSubmit={registerProfile}>
                <fieldset disabled={working}>
                  <legend>{t("profile.newLegend")}</legend>

                  <div className="avatar-editor">
                    <div className="avatar-preview" aria-live="polite">
                      {avatarPreviewUrl ? (
                        <img src={avatarPreviewUrl} alt={t("profile.avatarPreviewAlt")} />
                      ) : (
                        <span aria-label={t("profile.avatarFallbackAria")}>
                          {profileInitial(normalizedName, t("profile.avatarFallbackInitial"))}
                        </span>
                      )}
                    </div>
                    <div className="avatar-editor__controls">
                      <p>{t("profile.avatarOptional")}</p>
                      <div className="avatar-editor__actions">
                        <button
                          className="avatar-action"
                          type="button"
                          onClick={() => captureInputRef.current?.click()}
                        >
                          {t("profile.capture")}
                        </button>
                        <button
                          className="avatar-action"
                          type="button"
                          onClick={() => uploadInputRef.current?.click()}
                        >
                          {t("profile.upload")}
                        </button>
                        {avatarFile ? (
                          <button
                            className="avatar-action"
                            type="button"
                            onClick={() => {
                              setAvatarFile(null);
                              setAvatarError(null);
                            }}
                          >
                            {t("profile.removeAvatar")}
                          </button>
                        ) : null}
                      </div>
                      <p className="field-hint">{t("profile.avatarHint")}</p>
                      {avatarError ? (
                        <p className="avatar-editor__error" role="alert">
                          {t(avatarErrorKeys[avatarError])}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <input
                    ref={captureInputRef}
                    className="sr-only"
                    type="file"
                    accept="image/*"
                    capture="user"
                    tabIndex={-1}
                    aria-hidden="true"
                    onChange={(event) => handleAvatarFile(event.currentTarget)}
                  />
                  <input
                    ref={uploadInputRef}
                    className="sr-only"
                    type="file"
                    accept="image/*"
                    tabIndex={-1}
                    aria-hidden="true"
                    onChange={(event) => handleAvatarFile(event.currentTarget)}
                  />

                  <label htmlFor="display-name">{t("profile.displayNameLabel")}</label>
                  <input
                    id="display-name"
                    name="displayName"
                    type="text"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.currentTarget.value)}
                    autoComplete="nickname"
                    maxLength={48}
                    placeholder={t("profile.displayNamePlaceholder")}
                    aria-describedby="display-name-hint"
                    required
                  />
                  <p className="field-hint" id="display-name-hint">
                    {t("profile.displayNameHint")}
                  </p>
                </fieldset>

                <div className="profile-actions">
                  <button
                    className="button button--primary"
                    type="submit"
                    disabled={!normalizedName || working}
                  >
                    {t("profile.confirm")}
                  </button>
                  <button
                    className="button button--secondary"
                    type="button"
                    disabled={working}
                    onClick={returnToLogin}
                  >
                    {t("profile.back")}
                  </button>
                </div>
              </form>
            )}
          </div>

          <div className="profile-status" aria-live="polite" aria-atomic="true">
            {working ? (
              <p className="notice" role="status">
                {t("profile.working")}
              </p>
            ) : snapshot.error ? (
              <p className="notice notice--error" role="alert">
                {translateProfileError(t, snapshot.error.code)}
              </p>
            ) : (
              <p className="notice">{t("profile.offlineNotice")}</p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
