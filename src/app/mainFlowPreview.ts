import { bootstrapApplication } from "./bootstrap";
import { createBundledBrowserProfileEntry } from "./bundledBrowserProfiles";

/** A fresh in-memory debug session; never initialize the desktop database. */
export function bootstrapMainFlowPreview() {
  return bootstrapApplication({
    detectRuntime: () => "browser",
    createDemoProfileEntry: () =>
      createBundledBrowserProfileEntry({ packageId: "mainflow-short", version: "0.1.3" }),
  });
}
