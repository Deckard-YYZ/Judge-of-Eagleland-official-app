import { useState, useSyncExternalStore, type FormEvent } from "react";
import type { GameSessionView } from "../../application/gameSessionView";
import type { LocalProfileSummary, ProfileEntry } from "../../application/profileEntry";
import { normalizeProfileDisplayName } from "../../application/profileEntry";
import { ThemeSwitch } from "../ThemeSwitch";
import type { UiThemeMode } from "../theme";

export interface ProfilePageProps {
  entry: ProfileEntry;
  themeMode: UiThemeMode;
  onThemeChange(mode: UiThemeMode): void;
  onAuthenticated(profile: Readonly<LocalProfileSummary>, session: GameSessionView): void;
}

export function ProfilePage({
  entry,
  themeMode,
  onThemeChange,
  onAuthenticated,
}: ProfilePageProps) {
  const snapshot = useSyncExternalStore(entry.subscribe, entry.getSnapshot);
  const [selectedProfileId, setSelectedProfileId] = useState(
    () => snapshot.profiles[0]?.profileId ?? "",
  );
  const [displayName, setDisplayName] = useState("");
  const working = snapshot.status === "working";
  const normalizedName = normalizeProfileDisplayName(displayName);

  const finish = (result: Awaited<ReturnType<ProfileEntry["enter"]>>): void => {
    if (result.ok) {
      onAuthenticated(result.profile, result.session);
    }
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
    finish(await entry.register(displayName));
  }

  return (
    <main className="profile-page">
      <section className="profile-intro" aria-labelledby="product-title">
        <div className="profile-intro__topbar">
          <div className="wordmark">
            <span className="wordmark__seal" aria-hidden="true">
              衡
            </span>
            <span>
              <strong>鹰国法官</strong>
              <small>司法档案处</small>
            </span>
          </div>
          <ThemeSwitch mode={themeMode} onChange={onThemeChange} />
        </div>

        <div className="profile-intro__copy">
          <p className="kicker">Office of judicial records · 01</p>
          <h1 id="product-title">每一项裁定，都将留下记录。</h1>
          <p>查阅案卷、核对证词，并在有限的事实中作出选择。你的判断将改变后续案件与最终结局。</p>
        </div>

        <p className="profile-intro__folio" aria-hidden="true">
          JUDICIAL ARCHIVE / LOCAL ACCESS
        </p>
      </section>

      <section className="profile-access" aria-labelledby="access-title">
        <div className="profile-access__header">
          <p className="kicker">Local profile</p>
          <h2 id="access-title">进入本地档案</h2>
          <p>当前为纯前端演示。档案只保存在本次应用内存中，刷新或关闭页面后将重置。</p>
        </div>

        <form className="profile-form" onSubmit={enterProfile}>
          <fieldset disabled={working || snapshot.profiles.length === 0}>
            <legend>选择已有档案</legend>
            <label htmlFor="local-profile">本地档案员</label>
            <div className="field-row">
              <select
                id="local-profile"
                value={selectedProfileId}
                onChange={(event) => setSelectedProfileId(event.currentTarget.value)}
              >
                {snapshot.profiles.map((profile) => (
                  <option key={profile.profileId} value={profile.profileId}>
                    {profile.displayName}
                  </option>
                ))}
              </select>
              <button className="button button--primary" type="submit">
                打开档案
              </button>
            </div>
          </fieldset>
        </form>

        <div className="section-divider" role="separator">
          <span>或建立新档案</span>
        </div>

        <form className="profile-form" onSubmit={registerProfile}>
          <fieldset disabled={working}>
            <legend>注册新的本地档案</legend>
            <label htmlFor="display-name">显示名称</label>
            <div className="field-row">
              <input
                id="display-name"
                name="displayName"
                type="text"
                value={displayName}
                onChange={(event) => setDisplayName(event.currentTarget.value)}
                autoComplete="nickname"
                maxLength={48}
                placeholder="例如：第七审理员"
                aria-describedby="display-name-hint"
                required
              />
              <button className="button button--secondary" type="submit" disabled={!normalizedName}>
                建立并进入
              </button>
            </div>
            <p className="field-hint" id="display-name-hint">
              仅作为本机演示中的称呼；不创建联网账户。
            </p>
          </fieldset>
        </form>

        <div className="profile-status" aria-live="polite" aria-atomic="true">
          {working ? (
            <p className="notice" role="status">
              正在准备本地档案…
            </p>
          ) : snapshot.error ? (
            <p className="notice notice--error" role="alert">
              {snapshot.error.message}
            </p>
          ) : (
            <p className="notice">无需网络连接，演示数据不会离开当前应用。</p>
          )}
        </div>
      </section>
    </main>
  );
}
