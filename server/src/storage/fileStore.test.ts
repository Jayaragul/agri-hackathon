import { describe, expect, it } from "vitest";
import { MemoryFileBackend } from "./fileStore";

describe("MemoryFileBackend", () => {
  it("round-trips binary data unchanged", async () => {
    const backend = new MemoryFileBackend();
    const data = Buffer.from([0, 1, 2, 255, 254, 253]);
    await backend.writeFile("soil-reports/s1/r1.pdf", data, "application/pdf");
    const read = await backend.readFile("soil-reports/s1/r1.pdf");
    expect(read).not.toBeNull();
    expect(Buffer.compare(read as Buffer, data)).toBe(0);
  });

  it("readFile returns null for a path that was never written", async () => {
    const backend = new MemoryFileBackend();
    expect(await backend.readFile("soil-reports/nope.pdf")).toBeNull();
  });

  it("writeFile overwrites a previous file at the same path", async () => {
    const backend = new MemoryFileBackend();
    await backend.writeFile("p", Buffer.from("first"), "text/plain");
    await backend.writeFile("p", Buffer.from("second"), "text/plain");
    const read = await backend.readFile("p");
    expect(read?.toString()).toBe("second");
  });

  it("returned buffer is a copy — mutating it does not corrupt the stored data", async () => {
    const backend = new MemoryFileBackend();
    await backend.writeFile("p", Buffer.from("original"), "text/plain");
    const read = await backend.readFile("p");
    read!.write("HACKED!!");
    const readAgain = await backend.readFile("p");
    expect(readAgain?.toString()).toBe("original");
  });
});
