import { api } from "./client.js";
import { TransferMeter } from "./transfer-progress.js";
import { createDownloadSink } from "./backup-storage.js";
import { fileIdentity, verifyUploadFile } from "./upload-identity.js";

function uploadChunk(url, body, signal, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    xhr.open("PUT", `./api/${url}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("X-Knowledge-Client", "atlas");
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () => {
      let result;
      try {
        result = JSON.parse(xhr.responseText);
      } catch {
        result = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(result);
      else
        reject(
          Object.assign(
            new Error(
              result.error ||
                "The transfer connection was interrupted. Resume to retry.",
            ),
            { status: xhr.status },
          ),
        );
    };
    xhr.onerror = () =>
      reject(
        new Error("The transfer connection was interrupted. Resume to retry."),
      );
    xhr.onabort = () =>
      reject(new DOMException("Transfer stopped.", "AbortError"));
    xhr.onloadend = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    xhr.send(body);
  });
}

const idle = {
  phase: "idle",
  loaded: 0,
  total: null,
  rate: 0,
  eta: null,
  error: "",
  preview: null,
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const abortError = () => new DOMException("Transfer stopped.", "AbortError");
const cleanupWarning =
  "Temporary transfer cleanup could not finish. Inactive transfers are retained for 7 days and cleaned at startup or when another transfer starts.";
const retryable = (error) =>
  [0, 408, 409, 429].includes(error.status) ||
  error.status >= 500 ||
  ["TypeError", "NetworkError", "AbortError"].includes(error.name) ||
  error.message === "The transfer connection was interrupted. Resume to retry.";
function errorMessage(error) {
  if (
    [
      "QuotaExceededError",
      "NotAllowedError",
      "SecurityError",
      "NotFoundError",
      "NoModificationAllowedError",
    ].includes(error.name)
  )
    return "Browser storage is unavailable. Check free space and storage permissions.";
  if (error.name === "TypeError" || error.name === "NetworkError")
    return "The transfer connection was interrupted. Resume to retry.";
  return error.message;
}

export class BackupTransfer {
  constructor({
    request = api,
    upload = uploadChunk,
    fetcher = (...args) => fetch(...args),
    sink = createDownloadSink,
    wait = delay,
    now,
    events = globalThis,
    page = globalThis.document,
    retryDelay = (attempt) =>
      Math.min(30000, 1000 * 2 ** Math.min(attempt - 1, 5)),
  } = {}) {
    Object.assign(this, { request, upload, fetcher, createSink: sink, wait });
    Object.assign(this, { events, page, retryDelay });
    this.meter = new TransferMeter(now);
    this.state = idle;
    this.listeners = new Set();
    this.subscribe = (fn) => {
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    };
    this.getSnapshot = () => this.state;
  }
  emit(patch) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }
  progress(loaded) {
    if (loaded !== this.pendingLoaded)
      this.lastNetworkProgress = this.meter.now();
    this.pendingLoaded = loaded;
    const now = this.meter.now();
    if (loaded < this.state.total && now - (this.lastPaint ?? -Infinity) < 100)
      return;
    this.lastPaint = now;
    this.emit({ loaded, ...this.meter.update(loaded, this.state.total) });
  }
  get active() {
    return !["idle", "complete", "cancelled", "error"].includes(
      this.state.phase,
    );
  }
  pause() {
    if (!["transferring", "reconnecting"].includes(this.state.phase)) return;
    this.paused = true;
    this.emit({ phase: "pausing", rate: 0, eta: null });
    this.controller?.abort();
    this.wake?.();
  }
  resume() {
    if (this.state.phase !== "paused") return;
    this.paused = false;
    this.emit({ phase: "transferring", error: "" });
    this.meter.reset(this.state.loaded);
    this.wake?.();
  }
  cancel() {
    if (!this.active || this.state.phase === "saving") return;
    this.cancelled = true;
    this.paused = false;
    this.emit({ phase: "cancelling", rate: 0, eta: null });
    this.controller?.abort();
    this.wake?.();
  }
  async clearPreview() {
    const id = this.previewSessionId;
    this.previewSessionId = null;
    this.emit({ preview: null });
    if (id)
      await this.request(`backup-transfers/${id}`, {
        method: "DELETE",
        body: JSON.stringify({ keepPreview: true }),
      }).catch((error) =>
        error.status === 404
          ? undefined
          : this.emit({
              error:
                "The saved transfer could not be removed. Try cancelling it again when the connection returns.",
            }),
      );
  }
  async gate() {
    if (this.cancelled) throw abortError();
    if (this.paused) {
      await new Promise((resolve) => {
        this.wake = resolve;
        this.emit({
          phase: "paused",
          loaded: this.committed,
          rate: 0,
          eta: null,
        });
      });
      this.wake = null;
    }
    if (this.cancelled) throw abortError();
    this.controller = new AbortController();
  }
  async status() {
    return this.request(`backup-transfers/${this.session.id}`, {
      signal: this.controller?.signal,
    });
  }
  async reconnect(error) {
    if (this.cancelled) throw abortError();
    this.retryAttempt = (this.retryAttempt || 0) + 1;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, this.retryDelay(this.retryAttempt));
      this.wake = () => {
        clearTimeout(timer);
        resolve();
      };
      this.emit({
        phase: "reconnecting",
        loaded: this.committed,
        rate: 0,
        eta: null,
        error: errorMessage(error),
      });
    });
    this.wake = null;
    await this.gate();
    this.meter.reset(this.committed);
    this.emit({ phase: "transferring", error: "" });
  }
  async poll(phase) {
    for (;;) {
      if (this.cancelled) throw abortError();
      let status;
      try {
        status = await this.status();
      } catch (error) {
        if (!retryable(error) || this.cancelled) throw error;
        await this.reconnect(error);
        continue;
      }
      if (status.state === "error") throw new Error(status.error);
      if (status.state === "ready") return status;
      this.emit({ phase });
      await this.wait(500);
    }
  }
  async release(keepPreview = false) {
    if (!this.session) return;
    await this.request(`backup-transfers/${this.session.id}`, {
      method: "DELETE",
      body: JSON.stringify({ keepPreview }),
    });
    this.session = null;
  }
  async merge(preview, options) {
    if (this.active) return;
    this.emit({
      phase: "merging",
      error: "",
      mergeResult: null,
      mergeProgress: null,
    });
    try {
      let status = await this.request(`packages/${preview.id}/import`, {
        method: "POST",
        body: JSON.stringify({ ...options, revision: preview.revision }),
      });
      while (status.phase === "applying") {
        this.emit({ mergeProgress: status });
        await this.wait(700);
        status = await this.request(`packages/${preview.id}/status`);
      }
      if (status.phase !== "complete")
        throw new Error(
          status.error ||
            "The package could not be imported. Check storage space and try again.",
        );
      await this.clearPreview();
      this.emit({ phase: "complete", mergeResult: status });
    } catch (error) {
      this.emit({ phase: "error", error: errorMessage(error) });
    }
  }
  async start(direction, file, resumeSession = null, purpose = "restore") {
    if (this.active) return;
    // Open a picker before the first await consumes transient user activation.
    const filename =
      direction === "upload"
        ? file?.name || resumeSession?.source?.name || "backup.zip"
        : `knowledge-atlas-backup-${new Date().toISOString().replaceAll(":", "-")}.zip`;
    const destination =
      direction === "download"
        ? this.createSink(filename)
        : Promise.resolve(null);
    destination.catch(() => {});
    const previousSink = this.sink;
    if (this.state.url) URL.revokeObjectURL(this.state.url);
    this.sink = null;
    this.session = resumeSession;
    this.cancelled = this.paused = false;
    this.controller = new AbortController();
    this.retryAttempt = 0;
    this.lastNetworkProgress = this.meter.now();
    this.committed = resumeSession?.offset || 0;
    this.pendingLoaded = this.committed;
    this.lastPaint = null;
    this.state = {
      ...idle,
      direction,
      purpose: resumeSession?.purpose || purpose,
      filename,
      total: resumeSession?.total ?? file?.size ?? null,
      loaded: this.committed,
      preview: direction === "download" ? this.state.preview : null,
    };
    this.emit({ phase: "starting" });
    const beforeUnload = (event) => {
      if (direction === "upload") return;
      event.preventDefault();
      event.returnValue = "";
    };
    globalThis.addEventListener?.("beforeunload", beforeUnload);
    const returned = () => {
      if (this.page?.visibilityState === "hidden") return;
      if (this.state.phase === "reconnecting") this.wake?.();
      else if (
        this.state.phase === "transferring" &&
        this.meter.now() - this.lastNetworkProgress > 60000
      ) {
        // A frozen tab may return with a stalled request. Abort only that
        // request; the retry loop reconciles durable bytes with the server.
        this.controller?.abort();
      }
    };
    this.events.addEventListener?.("online", returned);
    this.events.addEventListener?.("focus", returned);
    this.page?.addEventListener("visibilitychange", returned);
    let ticker;
    try {
      try {
        this.sink = await destination;
      } finally {
        await previousSink?.discard();
      }
      if (this.cancelled) throw abortError();
      if (resumeSession) {
        const proof = await this.request(
          `backup-transfers/${resumeSession.id}/proof`,
        );
        this.session = proof;
        this.committed = proof.offset;
        this.pendingLoaded = proof.offset;
        this.emit({ loaded: proof.offset, total: proof.total });
        if (proof.offset < proof.total) {
          this.controller = new AbortController();
          this.emit({
            phase: "checking",
            checked: 0,
            checkTotal: proof.offset,
          });
          await verifyUploadFile(
            file,
            proof,
            (checked, checkTotal) => this.emit({ checked, checkTotal }),
            this.controller.signal,
          );
        }
      } else {
        const source =
          direction === "upload" ? await fileIdentity(file) : undefined;
        if (this.cancelled) throw abortError();
        this.session = await this.request("backup-transfers", {
          method: "POST",
          body: JSON.stringify({
            direction,
            size: file?.size,
            source,
            purpose,
          }),
        });
      }
      if (this.cancelled) throw abortError();
      if (direction === "download") {
        this.emit({ phase: "preparing" });
        const status = await this.poll("preparing");
        this.emit({ total: status.total });
      }
      this.emit({ phase: "transferring" });
      this.meter.reset(this.committed);
      ticker = setInterval(() => {
        if (this.state.phase === "transferring")
          this.progress(this.pendingLoaded);
      }, 500);
      while (this.committed < this.state.total) {
        await this.gate();
        try {
          if (direction === "upload") {
            // Reconcile a chunk committed just before a pause or lost response.
            const status = await this.status();
            if (this.committed !== status.offset)
              this.meter.reset(status.offset);
            this.committed = status.offset;
            if (this.paused || this.cancelled) continue;
            if (this.committed >= this.state.total) break;
            const start = this.committed;
            const result = await this.upload(
              `backup-transfers/${this.session.id}/chunk?offset=${start}`,
              file.slice(start, start + this.session.chunkSize),
              this.controller.signal,
              (bytes) => this.progress(start + bytes),
            );
            this.committed = result.offset;
          } else {
            const end =
              Math.min(
                this.state.total,
                this.committed + this.session.chunkSize,
              ) - 1;
            const response = await this.fetcher(
              `./api/backup-transfers/${this.session.id}/file`,
              {
                signal: this.controller.signal,
                headers: { Range: `bytes=${this.committed}-${end}` },
                cache: "no-store",
              },
            );
            if (
              response.status !== 206 ||
              response.headers.get("Content-Range") !==
                `bytes ${this.committed}-${end}/${this.state.total}`
            )
              throw Object.assign(
                new Error("The server returned an invalid download range."),
                { status: response.status },
              );
            const reader = response.body.getReader();
            const chunks = [];
            let bytes = 0;
            try {
              for (;;) {
                const part = await reader.read();
                if (part.done) break;
                bytes += part.value.byteLength;
                if (bytes > end - this.committed + 1)
                  throw new Error(
                    "The server returned an invalid download range.",
                  );
                chunks.push(part.value);
                this.progress(this.committed + bytes);
              }
            } finally {
              await reader.cancel().catch(() => {});
            }
            if (bytes !== end - this.committed + 1)
              throw new Error(
                "The transfer connection was interrupted. Resume to retry.",
              );
            // At most one small chunk is assembled. Completed chunks survive pause.
            const chunk = new Uint8Array(bytes);
            let offset = 0;
            for (const part of chunks) {
              chunk.set(part, offset);
              offset += part.byteLength;
            }
            await this.sink.write(chunk);
            this.committed += bytes;
          }
          this.retryAttempt = 0;
          this.progress(this.committed);
        } catch (error) {
          if (this.cancelled) throw error;
          if (!this.paused) {
            if (retryable(error)) {
              await this.reconnect(error);
              continue;
            }
            if (
              error.status >= 400 &&
              error.status < 500 &&
              error.status !== 409
            )
              throw error;
            this.paused = true;
            this.emit({ error: errorMessage(error) });
          }
        }
      }
      await this.gate();
      clearInterval(ticker);
      this.emit({ loaded: this.state.total, rate: 0, eta: null });
      if (direction === "upload") {
        this.emit({ phase: "verifying" });
        await this.request(`backup-transfers/${this.session.id}/complete`, {
          method: "POST",
          body: "{}",
        });
        const status = await this.poll("verifying");
        if (this.cancelled) throw abortError();
        this.emit({ phase: "saving" });
        this.previewSessionId = this.session.id;
        this.emit({
          phase: "complete",
          preview: status.preview,
          error: "",
        });
      } else {
        this.emit({ phase: "saving" });
        const blob = await this.sink.finish();
        let warning = "";
        await this.release().catch(() => {
          warning = cleanupWarning;
        });
        const url = blob ? URL.createObjectURL(blob) : null;
        this.emit({ phase: "complete", url, error: warning });
      }
    } catch (error) {
      let cleanupError;
      // Disconnection, a closed page or a wrong selected file must never erase
      // an upload. Only an explicit Cancel discards confirmed server bytes.
      if (direction !== "upload" || this.cancelled) {
        try {
          await this.release();
        } catch (e) {
          cleanupError = e;
        }
      }
      try {
        await this.sink?.discard();
      } catch (e) {
        cleanupError ||= e;
      }
      this.sink = null;
      this.emit({
        phase:
          this.cancelled || error.name === "AbortError" ? "cancelled" : "error",
        rate: 0,
        eta: null,
        error: cleanupError
          ? direction === "upload"
            ? "The saved transfer could not be removed. Try cancelling it again when the connection returns."
            : cleanupWarning
          : this.cancelled || error.name === "AbortError"
            ? ""
            : errorMessage(error),
      });
    } finally {
      clearInterval(ticker);
      globalThis.removeEventListener?.("beforeunload", beforeUnload);
      this.events.removeEventListener?.("online", returned);
      this.events.removeEventListener?.("focus", returned);
      this.page?.removeEventListener("visibilitychange", returned);
    }
  }
}

export const backupTransfer = new BackupTransfer();
