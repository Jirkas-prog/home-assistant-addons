import { t, locale } from "../shared/i18n.js";
import React, { useState, useEffect, useRef } from "react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
GlobalWorkerOptions.workerSrc = worker;
export default function PdfViewer({ url }) {
  const [pdf, setPdf] = useState(null),
    [page, setPage] = useState(1),
    [scale, setScale] = useState(1),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [password, setPassword] = useState(""),
    [passwordNeeded, setPasswordNeeded] = useState(false),
    [text, setText] = useState("");
  const canvas = useRef(),
    renderQueue = useRef(Promise.resolve()),
    passwordCallback = useRef();
  useEffect(() => {
    let live = true;
    setError("");
    setLoading(true);
    const assets = new URL("./pdf-assets/", document.baseURI).href;
    const task = getDocument({
      url,
      cMapUrl: assets + "cmaps/",
      cMapPacked: true,
      standardFontDataUrl: assets + "standard_fonts/",
      wasmUrl: assets + "wasm/",
      iccUrl: assets + "iccs/",
      isEvalSupported: false,
    });
    task.onPassword = (fn) => {
      passwordCallback.current = fn;
      setPasswordNeeded(true);
      setLoading(false);
    };
    task.promise
      .then((doc) => {
        if (live) {
          setPdf(doc);
          setPage(1);
        }
      })
      .catch((e) => {
        if (live) {
          setError(t("m215", e.message));
          setLoading(false);
        }
      });
    return () => {
      live = false;
      task.destroy();
    };
  }, [url]);
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false,
      renderTask;
    setLoading(true);
    setError("");
    renderQueue.current = renderQueue.current
      .catch(() => {})
      .then(async () => {
        if (cancelled) return;
        try {
          const pdfPage = await pdf.getPage(page);
          if (cancelled) return;
          const viewport = pdfPage.getViewport({
              scale,
            }),
            ratio = Math.min(window.devicePixelRatio || 1, 2),
            el = canvas.current;
          el.width = Math.floor(viewport.width * ratio);
          el.height = Math.floor(viewport.height * ratio);
          el.style.width = `${viewport.width}px`;
          el.style.height = `${viewport.height}px`;
          renderTask = pdfPage.render({
            canvasContext: el.getContext("2d"),
            viewport,
            transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0],
          });
          await renderTask.promise;
          const content = await pdfPage.getTextContent();
          if (!cancelled) setText(content.items.map((i) => i.str).join(" "));
        } catch (e) {
          if (!cancelled && e.name !== "RenderingCancelledException")
            setError(e.message);
        } finally {
          if (!cancelled) setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdf, page, scale]);
  return (
    <div className="pdf-viewer">
      <div className="document-toolbar">
        <div>
          <button
            className="icon-button"
            aria-label={t("m216")}
            disabled={!pdf || page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft />
          </button>
          <label>
            {t("m217") + " "}
            <input
              aria-label={t("m218")}
              type="number"
              min="1"
              max={pdf?.numPages || 1}
              value={page}
              onChange={(e) =>
                setPage(
                  Math.max(
                    1,
                    Math.min(pdf?.numPages || 1, Number(e.target.value) || 1),
                  ),
                )
              }
            />
          </label>
          <span> / {pdf?.numPages || "…"}</span>
          <button
            className="icon-button"
            aria-label={t("m219")}
            disabled={!pdf || page >= pdf.numPages}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight />
          </button>
        </div>
        <div>
          <button
            className="icon-button"
            aria-label={t("m220")}
            disabled={scale <= 0.3}
            onClick={() => setScale((s) => Math.max(0.3, s - 0.2))}
          >
            <Minus />
          </button>
          <span>{Math.round(scale * 100)} %</span>
          <button
            className="icon-button"
            aria-label={t("m221")}
            disabled={scale >= 2.5}
            onClick={() => setScale((s) => Math.min(2.5, s + 0.2))}
          >
            <Plus />
          </button>
        </div>
      </div>
      {passwordNeeded && (
        <form
          className="pdf-password"
          onSubmit={(e) => {
            e.preventDefault();
            passwordCallback.current?.(password);
            setPasswordNeeded(false);
            setLoading(true);
          }}
        >
          <label>
            {t("m222")}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="primary-button">{t("m223")}</button>
        </form>
      )}
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {loading && (
        <p className="document-message" role="status">
          {t("m224")}
        </p>
      )}
      <div className="pdf-page">
        <canvas ref={canvas} aria-label={t("m402", page)} />
      </div>
      {text && (
        <details className="pdf-text">
          <summary>{t("m225")}</summary>
          <p>{text}</p>
        </details>
      )}
    </div>
  );
}
