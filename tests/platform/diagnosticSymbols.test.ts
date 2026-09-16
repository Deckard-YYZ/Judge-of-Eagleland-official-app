import { expect, it } from "vitest";
// @ts-expect-error Standalone Node build utility intentionally ships as plain ESM.
import { verifySymbols } from "../../scripts/diagnostic-symbols.mjs";

it("validates PE debug directory against the PDB info stream and rejects mismatches", () => {
  const exe = Buffer.alloc(1024);
  exe.writeUInt32LE(64, 60);
  exe.write("PE\0\0", 64);
  exe.writeUInt16LE(1, 70);
  exe.writeUInt16LE(240, 84);
  exe.writeUInt16LE(0x20b, 88);
  exe.writeUInt32LE(0x1000, 248);
  exe.writeUInt32LE(28, 252);
  exe.writeUInt32LE(0x1000, 340);
  exe.writeUInt32LE(512, 344);
  exe.writeUInt32LE(512, 348);
  exe.writeUInt32LE(2, 524);
  exe.writeUInt32LE(24, 528);
  exe.writeUInt32LE(600, 536);
  exe.write("RSDS", 600);
  const guid = Buffer.alloc(16, 42);
  guid.copy(exe, 604);
  exe.writeUInt32LE(1, 620);
  const pdb = Buffer.alloc(512 * 6);
  pdb.write("Microsoft C/C++ MSF 7.00\r\n\x1aDS\0\0\0");
  pdb.writeUInt32LE(512, 32);
  pdb.writeUInt32LE(16, 44);
  pdb.writeUInt32LE(1, 52);
  pdb.writeUInt32LE(2, 512);
  pdb.writeUInt32LE(2, 1024);
  pdb.writeUInt32LE(0, 1028);
  pdb.writeUInt32LE(28, 1032);
  pdb.writeUInt32LE(3, 1036);
  pdb.writeUInt32LE(1, 1544);
  guid.copy(pdb, 1548);
  expect(() => verifySymbols(exe, pdb)).not.toThrow();
  pdb.writeUInt32LE(2, 1544);
  expect(() => verifySymbols(exe, pdb)).toThrow(/does not match/);
  // A matching GUID elsewhere must not bypass the actual info-stream mismatch.
  guid.copy(pdb, 2000);
  pdb.writeUInt32LE(1, 1996);
  expect(() => verifySymbols(exe, pdb)).toThrow(/does not match/);
  pdb.writeUInt32LE(0xffffffff, 52);
  expect(() => verifySymbols(exe, pdb)).toThrow();
});
