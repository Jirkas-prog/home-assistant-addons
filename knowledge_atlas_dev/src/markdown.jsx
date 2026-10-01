import React from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { t } from "../shared/i18n.js";

export function MarkdownContent({ children }) {
  return (
    <div className="markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, href, children, ...props }) =>
            /^https?:\/\/|^mailto:/i.test(href || "") ? (
              <a {...props} href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ) : (
              <span title={t("m084", href || "")}>{children}</span>
            ),
          img: ({ alt }) => (
            <span className="image-placeholder">
              {t("m085") + " "}
              {alt || t("m394")}
            </span>
          ),
        }}
      >
        {children || t("m086")}
      </Markdown>
    </div>
  );
}
