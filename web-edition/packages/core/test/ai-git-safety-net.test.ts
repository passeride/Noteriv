import { describe, it, expect, beforeEach } from "vitest";
import { MemoryVaultAdapter } from "../src/memory-vault-adapter";
import { GitSafetyNet, wrapAdapterWithSafetyNet } from "../src/ai-git-safety-net";

describe("AI Git Safety Net (Pre-edit Snapshots & 1-Click Rollback)", () => {
  let adapter: MemoryVaultAdapter;
  let safetyNet: GitSafetyNet;

  beforeEach(() => {
    adapter = new MemoryVaultAdapter({
      "Thesis/Chapter1.md": "Original draft of Chapter 1.",
      "Notes/Ideas.md": "My early ideas.",
    });
    safetyNet = new GitSafetyNet();
  });

  it("records a safety snapshot before modifying note", async () => {
    const wrapped = wrapAdapterWithSafetyNet(adapter, safetyNet);

    // AI edits Chapter1
    await wrapped.writeNote("Thesis/Chapter1.md", "AI rewritten Chapter 1 with hallucinations.");

    const snapshots = safetyNet.listSnapshots("Thesis/Chapter1.md");
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].content).toBe("Original draft of Chapter 1.");
    expect(snapshots[0].notePath).toBe("Thesis/Chapter1.md");
  });

  it("rolls back note to previous snapshot in 1 click", async () => {
    const wrapped = wrapAdapterWithSafetyNet(adapter, safetyNet);

    await wrapped.writeNote("Thesis/Chapter1.md", "Modified version 1.");
    expect(await adapter.readNote("Thesis/Chapter1.md")).toBe("Modified version 1.");

    const latest = safetyNet.getLatestSnapshot("Thesis/Chapter1.md");
    expect(latest).toBeDefined();

    const ok = await safetyNet.rollback(latest!.id, adapter);
    expect(ok).toBe(true);

    const restored = await adapter.readNote("Thesis/Chapter1.md");
    expect(restored).toBe("Original draft of Chapter 1.");
  });

  it("retains multiple revision snapshots in chronological order", async () => {
    const wrapped = wrapAdapterWithSafetyNet(adapter, safetyNet);

    await wrapped.writeNote("Notes/Ideas.md", "Ideas v2");
    await wrapped.writeNote("Notes/Ideas.md", "Ideas v3");

    const history = safetyNet.listSnapshots("Notes/Ideas.md");
    expect(history).toHaveLength(2);
    expect(history[0].content).toBe("My early ideas.");
    expect(history[1].content).toBe("Ideas v2");
  });
});
