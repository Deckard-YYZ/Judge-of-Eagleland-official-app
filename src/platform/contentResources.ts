import { invoke } from "@tauri-apps/api/core";

/** Filesystem transport only: content validation belongs to the content layer. */
export interface BundledPackageFiles {
  readonly sources: readonly { readonly source: string; readonly text: string }[];
  readonly fileInventory: readonly string[];
}

export type BundledPackageReader = (
  ref: Readonly<{ packageId: string; version: string }>,
) => Promise<BundledPackageFiles>;

/** Narrow native command: callers cannot supply an arbitrary filesystem path. */
export const readBundledContentPackage: BundledPackageReader = (ref) =>
  invoke<BundledPackageFiles>("read_bundled_content_package", {
    packageId: ref.packageId,
    version: ref.version,
  });
