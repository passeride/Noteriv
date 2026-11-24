import { sampleVault, type SampleVaultLocale } from "@noteriv/core/sample-vault";
import { webApi } from "@/lib/webApi";

/**
 * Creates the "Getting started" vault for a user who just signed up. It goes through the same import path as
 * "Import a folder" so the server needs nothing new; `finalize` rebuilds backlinks once every note exists, which is
 * what lets the sample notes link to each other.
 */
export async function createSampleVault(locale: SampleVaultLocale): Promise<string> {
  const { name, files } = sampleVault(locale);
  const vault = await webApi.vaults.create({ name });
  await webApi.vaultTransfer.importNotes(vault.id, files, "skip");
  await webApi.vaultTransfer.finalize(vault.id);
  return vault.id;
}
