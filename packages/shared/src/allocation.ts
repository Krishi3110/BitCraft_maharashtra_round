export async function computeHash(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function computeHMAC(keyStr: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(keyStr);
  const key = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  const signatureArray = Array.from(new Uint8Array(signatureBuffer));
  return signatureArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function generateServerSeed(): Promise<string> {
  const randomBuffer = new Uint8Array(32);
  crypto.getRandomValues(randomBuffer);
  return Array.from(randomBuffer).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function computeSeedCommitment(seed: string): Promise<string> {
  return computeHash(seed);
}

export interface AllocationResult {
  snapshotHash: string;
  finalSeed: string;
  winners: string[];
  waitlist: string[];
  resultHash: string;
  eligibleCount: number;
}

export async function allocate(participants: string[], serverSeed: string, inventory: number): Promise<AllocationResult> {
  // 1. Deduplicate by exact string identity
  const uniqueParticipants = Array.from(new Set(participants));

  // 2. Lexicographical Sort for canonical snapshot
  uniqueParticipants.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  // 3. Snapshot Hash (Canonical JSON array)
  const snapshotHash = await computeHash(JSON.stringify(uniqueParticipants));

  // 4. Final Seed calculation: SHA-256("fairdrop-hmac-rank-v1" ‖ server_seed ‖ snapshot_hash)
  const finalSeedStr = `fairdrop-hmac-rank-v1${serverSeed}${snapshotHash}`;
  const finalSeed = await computeHash(finalSeedStr);

  // 5. Rank computation
  const ranks = await Promise.all(
    uniqueParticipants.map(async (p) => {
      const hmac = await computeHMAC(finalSeed, p);
      return { p, hmac };
    })
  );

  // 6. Sort by HMAC hex, then by ID as a stable tie-breaker
  ranks.sort((a, b) => {
    if (a.hmac === b.hmac) {
      return a.p < b.p ? -1 : a.p > b.p ? 1 : 0;
    }
    return a.hmac < b.hmac ? -1 : 1;
  });

  const sortedParticipants = ranks.map((r) => r.p);

  // 7. Select Winners
  const winnersCount = Math.min(inventory, sortedParticipants.length);
  const winners = sortedParticipants.slice(0, winnersCount);
  const waitlist = sortedParticipants.slice(winnersCount);

  // 8. Result Hash (Hash of winners for independent verification)
  const resultHash = await computeHash(JSON.stringify(winners));

  return {
    snapshotHash,
    finalSeed,
    winners,
    waitlist,
    resultHash,
    eligibleCount: uniqueParticipants.length,
  };
}
