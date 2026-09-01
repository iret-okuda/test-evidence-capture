"use strict";

const assert = require("node:assert/strict");
require("../storage.js");

const { createUniqueFileHandle, dataUrlToBlob, savePngToDirectory } =
  globalThis.TestEvidenceStorage;

class MemoryDirectory {
  constructor(existingNames = []) {
    this.files = new Map(existingNames.map((name) => [name, new MemoryFile(name)]));
  }

  async getFileHandle(name, options = {}) {
    if (this.files.has(name)) {
      return this.files.get(name);
    }
    if (options.create) {
      const file = new MemoryFile(name);
      this.files.set(name, file);
      return file;
    }
    const error = new Error("File not found");
    error.name = "NotFoundError";
    throw error;
  }
}

class MemoryFile {
  constructor(name) {
    this.name = name;
    this.blob = null;
  }

  async createWritable() {
    return {
      write: async (blob) => {
        this.blob = blob;
      },
      close: async () => {},
      abort: async () => {},
    };
  }
}

(async () => {
  const directory = new MemoryDirectory(["AC-1-1-1-after.png"]);
  const unique = await createUniqueFileHandle(directory, "AC-1-1-1-after.png");
  assert.equal(unique.name, "AC-1-1-1-after (1).png");

  const blob = dataUrlToBlob("data:image/png;base64,SGVsbG8=");
  assert.equal(blob.type, "image/png");
  assert.equal(await blob.text(), "Hello");

  const savedName = await savePngToDirectory(
    directory,
    "AC-2-1-1-before.png",
    "data:image/png;base64,UE5H",
  );
  assert.equal(savedName, "AC-2-1-1-before.png");
  assert.equal(await directory.files.get("AC-2-1-1-before.png").blob.text(), "PNG");

  console.log("storage tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
