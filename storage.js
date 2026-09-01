(function exposeStorage(global) {
  "use strict";

  const DIRECTORY_DATABASE_NAME = "test-evidence-capture";
  const DIRECTORY_STORE_NAME = "settings";
  const DIRECTORY_HANDLE_KEY = "capture-directory";

  async function savePngToDirectory(directoryHandle, filename, dataUrl) {
    const fileHandle = await createUniqueFileHandle(directoryHandle, filename);
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(dataUrlToBlob(dataUrl));
      await writable.close();
      return fileHandle.name;
    } catch (error) {
      try {
        await writable.abort();
      } catch {
        // Preserve the original write error.
      }
      throw error;
    }
  }

  async function createUniqueFileHandle(directoryHandle, filename) {
    const extensionIndex = filename.toLowerCase().lastIndexOf(".png");
    const basename = extensionIndex >= 0 ? filename.slice(0, extensionIndex) : filename;
    const extension = extensionIndex >= 0 ? filename.slice(extensionIndex) : ".png";

    for (let index = 0; index < 1000; index += 1) {
      const candidate = index === 0 ? `${basename}${extension}` : `${basename} (${index})${extension}`;
      try {
        await directoryHandle.getFileHandle(candidate);
      } catch (error) {
        if (error?.name === "NotFoundError") {
          return directoryHandle.getFileHandle(candidate, { create: true });
        }
        throw error;
      }
    }

    throw new Error("No available filename could be found in the selected directory.");
  }

  function dataUrlToBlob(dataUrl) {
    const separatorIndex = dataUrl.indexOf(",");
    if (separatorIndex < 0 || !dataUrl.slice(0, separatorIndex).includes(";base64")) {
      throw new Error("Invalid PNG data URL.");
    }

    const metadata = dataUrl.slice(0, separatorIndex);
    const mimeType = metadata.match(/^data:([^;]+)/)?.[1] || "image/png";
    const binary = atob(dataUrl.slice(separatorIndex + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mimeType });
  }

  async function rememberDirectoryHandle(directoryHandle) {
    const database = await openDirectoryDatabase();
    try {
      await runDirectoryRequest(
        database,
        "readwrite",
        (store) => store.put(directoryHandle, DIRECTORY_HANDLE_KEY),
      );
    } finally {
      database.close();
    }
  }

  async function loadDirectoryHandle() {
    const database = await openDirectoryDatabase();
    try {
      return await runDirectoryRequest(
        database,
        "readonly",
        (store) => store.get(DIRECTORY_HANDLE_KEY),
      );
    } finally {
      database.close();
    }
  }

  function openDirectoryDatabase() {
    return new Promise((resolve, reject) => {
      if (!global.indexedDB) {
        reject(new Error("IndexedDB is unavailable."));
        return;
      }
      const request = global.indexedDB.open(DIRECTORY_DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(DIRECTORY_STORE_NAME)) {
          database.createObjectStore(DIRECTORY_STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open IndexedDB."));
    });
  }

  function runDirectoryRequest(database, mode, createRequest) {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(DIRECTORY_STORE_NAME, mode);
      const request = createRequest(transaction.objectStore(DIRECTORY_STORE_NAME));
      let result;
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () =>
        reject(transaction.error || new Error("IndexedDB transaction was aborted."));
    });
  }

  global.TestEvidenceStorage = Object.freeze({
    savePngToDirectory,
    createUniqueFileHandle,
    dataUrlToBlob,
    rememberDirectoryHandle,
    loadDirectoryHandle,
  });
})(globalThis);
