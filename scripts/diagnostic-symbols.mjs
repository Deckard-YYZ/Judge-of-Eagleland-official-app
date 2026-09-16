/** Read PE CodeView and MSF 7 PDB info-stream identities, with bounded offsets. */
export function verifySymbols(exe, pdb) {
  const u32 = (bytes, at) => {
    if (at < 0 || at + 4 > bytes.length) throw new Error("Invalid symbol structure");
    return bytes.readUInt32LE(at);
  };
  const pe = u32(exe, 60);
  if (exe.toString("ascii", pe, pe + 4) !== "PE\0\0") throw new Error("Invalid PE");
  const optional = pe + 24;
  const magic = exe.readUInt16LE(optional);
  const directories =
    optional +
    (magic === 0x20b
      ? 112
      : magic === 0x10b
        ? 96
        : (() => {
            throw new Error("Invalid PE optional header");
          })());
  const debugRva = u32(exe, directories + 48),
    debugSize = u32(exe, directories + 52);
  const sections = optional + exe.readUInt16LE(pe + 20);
  let debugOffset;
  for (let n = 0; n < exe.readUInt16LE(pe + 6); n++) {
    const section = sections + n * 40;
    const rva = u32(exe, section + 12),
      size = u32(exe, section + 16);
    if (debugRva >= rva && debugRva < rva + size)
      debugOffset = u32(exe, section + 20) + debugRva - rva;
  }
  if (debugOffset === undefined || debugSize > 1024 * 1024)
    throw new Error("Missing PE debug directory");
  const identities = [];
  for (let n = 0; n + 28 <= debugSize; n += 28) {
    const entry = debugOffset + n;
    if (u32(exe, entry + 12) !== 2) continue;
    const at = u32(exe, entry + 24);
    if (u32(exe, entry + 16) >= 24 && exe.toString("ascii", at, at + 4) === "RSDS")
      identities.push({ guid: exe.subarray(at + 4, at + 20), age: u32(exe, at + 20) });
  }
  if (!pdb.subarray(0, 32).equals(Buffer.from("Microsoft C/C++ MSF 7.00\r\n\x1aDS\0\0\0")))
    throw new Error("Unsupported PDB format");
  const blockSize = u32(pdb, 32),
    directorySize = u32(pdb, 44),
    mapBlock = u32(pdb, 52);
  if (![512, 1024, 2048, 4096, 8192].includes(blockSize) || directorySize > 16 * 1024 * 1024)
    throw new Error("Invalid PDB directory");
  const blocks = Math.ceil(directorySize / blockSize);
  if (blocks * 4 > blockSize) throw new Error("Unsupported PDB directory block map");
  const readBlocks = (numbers, size) =>
    Buffer.concat(
      numbers.map((number) => {
        const start = number * blockSize;
        if (start + blockSize > pdb.length) throw new Error("PDB block outside file");
        return pdb.subarray(start, start + blockSize);
      }),
    ).subarray(0, size);
  const directory = readBlocks(
    Array.from({ length: blocks }, (_, n) => u32(pdb, mapBlock * blockSize + n * 4)),
    directorySize,
  );
  const count = u32(directory, 0);
  if (count < 2 || count > 100_000) throw new Error("PDB info stream missing");
  const stream0Size = u32(directory, 4),
    infoSize = u32(directory, 8);
  if (infoSize < 28 || infoSize > 16 * 1024 * 1024) throw new Error("Invalid PDB info stream");
  const infoBlocksAt =
    4 + count * 4 + (stream0Size === 0xffffffff ? 0 : Math.ceil(stream0Size / blockSize) * 4);
  const info = readBlocks(
    Array.from({ length: Math.ceil(infoSize / blockSize) }, (_, n) =>
      u32(directory, infoBlocksAt + n * 4),
    ),
    infoSize,
  );
  if (
    !identities.some(
      (identity) => identity.age === u32(info, 8) && identity.guid.equals(info.subarray(12, 28)),
    )
  )
    throw new Error("PDB does not match executable GUID and age");
}
