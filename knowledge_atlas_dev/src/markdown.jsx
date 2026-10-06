import React, { lazy, Suspense } from "react";
import { t } from "../shared/i18n.js";
const Renderer = lazy(() => import("./markdown-renderer.jsx"));
export function MarkdownContent({ children }) {
  return (
    <Suspense fallback={<p role="status">{t("m148")}</p>}>
      <Renderer>{children}</Renderer>
    </Suspense>
  );
}
