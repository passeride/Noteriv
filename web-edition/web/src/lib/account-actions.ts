// The account actions offered both on "Your vaults" and in the TermsGate dialog: download everything, delete the account.

import { webApi } from "./webApi";
import { clearCachedPages } from "@/components/ServiceWorkerRegister";
import { clearOfflineData } from "./offline-store";

/** Saves the account's full data export (GET /users/me/export) as a JSON file. */
export async function downloadMyData(): Promise<void> {
  const data = await webApi.users.exportData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "noteriv-export.json";
  a.click();
  URL.revokeObjectURL(url);
}

/** Deletes the account for good, then forgets what this device kept. The caller asks for confirmation first. */
export async function deleteMyAccount(password: string): Promise<void> {
  await webApi.users.deleteAccount(password);
  clearCachedPages();
  await clearOfflineData();
}
