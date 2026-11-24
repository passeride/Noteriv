import { lookup } from "node:dns/promises";
import net from "node:net";

// Sync remotes (Git, WebDAV) are addresses users type, fetched by the worker from inside our network. Only public
// hosts are reached: a URL naming localhost, a private range or the cloud metadata address would otherwise let a
// user read internal services through sync. The name is resolved here and every address checked; a DNS answer that
// changes between this check and git/axios connecting is not covered (the worker's own network is the other half).
//
// A self-hosted server whose Git or WebDAV lives on the same network (a NAS, Gitea on the LAN, Tailscale) sets
// SYNC_ALLOW_PRIVATE_REMOTES=1, which also allows plain http:// remotes.

export const privateRemotesAllowed = () => process.env.SYNC_ALLOW_PRIVATE_REMOTES === "1";

function privateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT, Tailscale
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast and reserved
  );
}

/** The 16 bytes of an IPv6 address in any written form (`::1`, `::ffff:7f00:1`, `::ffff:127.0.0.1`). */
function v6Bytes(ip: string): number[] | null {
  let s = ip.toLowerCase().split("%")[0];
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const [a, b, c, d] = tail[1].split(".").map(Number);
    s = s.slice(0, -tail[1].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  const groups = [...head, ...Array(fill).fill("0"), ...rest];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.flatMap((g) => [parseInt(g, 16) >> 8, parseInt(g, 16) & 255]);
}

function privateV6(ip: string): boolean {
  const b = v6Bytes(ip);
  if (!b) return true;
  const v4 = (o: number) => `${b[o]}.${b[o + 1]}.${b[o + 2]}.${b[o + 3]}`;
  const zero = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  if (zero(0, 16) || (zero(0, 15) && b[15] === 1)) return true; // ::, ::1
  // IPv4 inside IPv6: mapped (::ffff:a.b.c.d), compatible (::a.b.c.d), NAT64 (64:ff9b::/96), 6to4 (2002:a.b.c.d::/16).
  if (zero(0, 10) && b[10] === 0xff && b[11] === 0xff) return privateV4(v4(12));
  if (zero(0, 12)) return privateV4(v4(12));
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zero(4, 12)) return privateV4(v4(12));
  if (b[0] === 0x20 && b[1] === 0x02) return privateV4(v4(2));
  return (b[0] & 0xfe) === 0xfc || (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) || b[0] === 0xff; // ULA, link-local, multicast
}

export function isPrivateAddress(ip: string): boolean {
  const kind = net.isIP(ip);
  return kind === 4 ? privateV4(ip) : kind === 6 ? privateV6(ip) : true;
}

/** Throws unless `url` names a host whose every address is public. Tests against local remotes set SYNC_ALLOW_LOCAL_REMOTES=1. */
export async function assertPublicRemote(url: string): Promise<void> {
  if (process.env.SYNC_ALLOW_LOCAL_REMOTES === "1" || privateRemotesAllowed()) return;
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  } catch {
    throw new Error("invalid remote URL");
  }
  // No host at all: a local path or file:// URL.
  if (!host) throw new Error("remote host is not a public address");
  const addresses = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error("remote host is not a public address");
  }
}
