import { MemoryVaultAdapter } from "../src/memory-vault-adapter";
import { runVaultAdapterContract } from "./vault-adapter-contract";

runVaultAdapterContract("MemoryVaultAdapter", (initial) => new MemoryVaultAdapter(initial));
