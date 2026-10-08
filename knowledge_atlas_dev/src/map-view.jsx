import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  lazy,
  Suspense,
} from "react";
import ForceGraph2D from "react-force-graph-2d";
import { Box, Search, LoaderCircle, GitBranch, Unlink2, X } from "lucide-react";
import { parentChangeIssue, mapLinkId } from "../shared/map-hierarchy.js";
import { t } from "../shared/i18n.js";
import { createMapActivation } from "./map-activation.js";
import { preserveMapCamera } from "./map-camera.js";
import { createBranchDrag } from "./map-positions.js";
import { labelEligible, declutterLabels } from "./map-labels.js";
import {
  mapNodeGeometry,
  paintMapNodePointer,
  pickMapNode2D,
} from "./map-node-geometry.js";
const Graph3D = lazy(() => import("./map3d.jsx"));
class MapBoundary extends React.Component {
  state = {
    error: false,
  };
  static getDerivedStateFromError() {
    return {
      error: true,
    };
  }
  render() {
    return this.state.error ? (
      <div className="empty">
        <Box />
        <h3>{t("m087")}</h3>
        <p>{t("m088")}</p>
      </div>
    ) : (
      this.props.children
    );
  }
}
export default function MapView({
  data,
  mode,
  selected: selectedId,
  onSelect,
  onOpen,
  viewerOpen,
  relations,
  graphRef,
  allNodes,
  positions,
  onPositions,
  dragDisabled,
  onParentChange,
  onClearFilters,
  resultsPending,
}) {
  const [linkMode, setLinkMode] = useState("browse"),
    [linkParent, setLinkParent] = useState(null),
    [linkSaving, setLinkSaving] = useState(false),
    [linkMessage, setLinkMessage] = useState(""),
    [linkError, setLinkError] = useState("");
  const mutation = useRef(false);
  const selected = linkParent || selectedId;
  const callbacks = useRef(),
    fitTimer = useRef(),
    fitted = useRef(false),
    visibleLabels = useRef(new Set());
  const drag = useRef(null),
    suppressClick = useRef(0);
  callbacks.current = { onSelect, onOpen, viewerOpen };
  const activation = useMemo(
    () =>
      createMapActivation({
        select: (node) => callbacks.current.onSelect(node),
        open: (node) => callbacks.current.onOpen(node),
      }),
    [],
  );
  useEffect(() => () => activation.cancel(), [activation, mode, data]);
  useEffect(() => {
    if (viewerOpen) {
      activation.cancel();
      clearTimeout(fitTimer.current);
    }
  }, [activation, viewerOpen]);
  useEffect(() => {
    if (viewerOpen) return preserveMapCamera(graphRef.current, mode);
  }, [viewerOpen, mode, graphRef]);
  const ref = useRef();
  const [size, setSize] = useState({
    width: 600,
    height: 600,
  });
  const [hover, setHover] = useState(null);
  const setEditingMode = (next) => {
    if (mutation.current) return;
    activation.cancel();
    setLinkMode(next);
    setLinkParent(null);
    setLinkMessage("");
    setLinkError("");
  };
  useEffect(() => {
    if (
      linkParent &&
      !resultsPending &&
      !data.nodes.some((n) => n.id === linkParent) &&
      !mutation.current
    ) {
      setLinkParent(null);
      setLinkError("");
      setLinkMessage(t("map.hierarchy.hiddenParent"));
    }
  }, [data.nodes, linkParent, resultsPending]);
  useEffect(() => {
    if (viewerOpen) setEditingMode("browse");
  }, [viewerOpen]);
  useEffect(() => {
    if (linkMode === "browse") return;
    const cancel = (event) => {
      if (
        mutation.current ||
        event.key !== "Escape" ||
        document.querySelector('[role="dialog"]')
      )
        return;
      if (linkParent) setLinkParent(null);
      else setEditingMode("browse");
    };
    document.addEventListener("keydown", cancel);
    return () => document.removeEventListener("keydown", cancel);
  }, [linkMode, linkParent]);
  async function reparent(childId, parentId) {
    if (mutation.current || dragDisabled) return;
    const issue = parentChangeIssue(allNodes, childId, parentId);
    if (issue) {
      setLinkError(t(`map.hierarchy.${issue}`));
      return;
    }
    mutation.current = true;
    setLinkSaving(true);
    setLinkError("");
    setLinkMessage("");
    const child = allNodes.find((n) => n.id === childId);
    const parent = allNodes.find((n) => n.id === parentId);
    try {
      await onParentChange(childId, parentId);
      setLinkParent(null);
      setLinkMessage(
        t(
          parentId === null ? "map.hierarchy.detached" : "map.hierarchy.linked",
          child.title,
          parent?.title,
        ),
      );
    } catch (error) {
      setLinkError(error.message);
    } finally {
      mutation.current = false;
      setLinkSaving(false);
    }
  }
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (callbacks.current.viewerOpen || fitted.current || !data.nodes.length)
      return;
    const timer = setTimeout(() => {
      if (!callbacks.current.viewerOpen && graphRef.current) {
        graphRef.current.zoomToFit(0, 65);
        fitted.current = true;
      }
    }, 350);
    fitTimer.current = timer;
    return () => clearTimeout(timer);
  }, [data, mode, size.width, size.height]);
  useEffect(() => {
    if (mode !== "2d") return;
    const host = ref.current;
    const wheel = (event) => {
      const graph = graphRef.current;
      const canvas = host.querySelector("canvas");
      if (!graph || !canvas || !event.deltaY) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const before = graph.screen2GraphCoords(x, y);
      // Match native wheel units and pinch gestures, with 25% more sensitivity.
      const unit = event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002;
      const delta = -event.deltaY * unit * (event.ctrlKey ? 10 : 1) * 1.25;
      graph.zoom(Math.max(0.002, Math.min(20, graph.zoom() * 2 ** delta)));
      const after = graph.screen2GraphCoords(x, y);
      const center = graph.centerAt();
      graph.centerAt(
        center.x + before.x - after.x,
        center.y + before.y - after.y,
      );
    };
    host.addEventListener("wheel", wheel, { capture: true, passive: false });
    return () => host.removeEventListener("wheel", wheel, true);
  }, [mode, graphRef]);
  const label = (n) => {
    const el = document.createElement("span");
    el.textContent = n.title;
    return el;
  };
  const click = (node, event, link) => {
    if (performance.now() < suppressClick.current || mutation.current) return;
    if (linkMode === "browse") {
      activation.click(node, event);
      return;
    }
    if (dragDisabled) return;
    activation.cancel();
    setLinkMessage("");
    setLinkError("");
    if (linkMode === "unlink") {
      if (node) reparent(node.id, null);
      else if (link?.kind === "tree") reparent(mapLinkId(link.target), null);
    } else if (node) {
      if (!linkParent) setLinkParent(node.id);
      else if (node.id === linkParent) setLinkParent(null);
      else reparent(node.id, linkParent);
    } else setLinkParent(null);
  };
  const dragNode = (node, rendered) => {
    activation.cancel();
    clearTimeout(fitTimer.current);
    fitted.current = true;
    suppressClick.current = performance.now() + 500;
    if (!drag.current)
      drag.current = createBranchDrag(allNodes, positions, node.id);
    return drag.current(node, rendered);
  };
  const endDrag = (node, rendered) => {
    const next = dragNode(node, rendered);
    drag.current = null;
    onPositions(next);
  };
  const select2DAtClick = (event, link) => {
    const canvas = ref.current?.querySelector("canvas");
    const instance = graphRef.current;
    if (!canvas || !instance) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;
    const node = pickMapNode2D(
      data.nodes,
      canvas.getContext("2d"),
      instance.zoom(),
      instance.screen2GraphCoords(x, y),
      selected,
      hover,
      visibleLabels.current,
    );
    click(node, event, link);
  };
  return (
    <div
      className="map-canvas"
      ref={ref}
      onDoubleClickCapture={(event) => {
        // Keep the canvas library from zooming on native double-click.
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div className="map-hierarchy-controls" data-map-editor>
        <div
          className="map-hierarchy-buttons"
          role="group"
          aria-label={t("map.hierarchy.tools")}
        >
          <button
            type="button"
            className="secondary-button"
            aria-pressed={linkMode === "link"}
            title={t("map.hierarchy.linkHint")}
            disabled={dragDisabled || viewerOpen}
            onClick={() =>
              setEditingMode(linkMode === "link" ? "browse" : "link")
            }
          >
            <GitBranch size={16} />
            {t("map.hierarchy.link")}
          </button>
          <button
            type="button"
            className="secondary-button"
            aria-pressed={linkMode === "unlink"}
            title={t("map.hierarchy.unlinkHint")}
            disabled={dragDisabled || viewerOpen}
            onClick={() =>
              setEditingMode(linkMode === "unlink" ? "browse" : "unlink")
            }
          >
            <Unlink2 size={16} />
            {t("map.hierarchy.unlink")}
          </button>
          {linkMode !== "browse" && (
            <button
              type="button"
              className="icon-button"
              disabled={linkSaving}
              aria-label={t("map.hierarchy.finish")}
              title={t("map.hierarchy.finish")}
              onClick={() => setEditingMode("browse")}
            >
              <X size={16} />
            </button>
          )}
        </div>
        {linkMode !== "browse" && (
          <div className="map-hierarchy-guide">
            <p role="status" className="map-hierarchy-prompt-full">
              {linkSaving
                ? t("map.hierarchy.saving")
                : linkMode === "unlink"
                  ? t("map.hierarchy.unlinkHint")
                  : linkParent
                    ? t(
                        "map.hierarchy.childPrompt",
                        allNodes.find((n) => n.id === linkParent)?.title || "",
                      )
                    : t("map.hierarchy.parentPrompt")}
            </p>
            <p role="status" className="map-hierarchy-prompt-short">
              {linkSaving
                ? t("map.hierarchy.saving")
                : linkMode === "unlink"
                  ? t("map.hierarchy.unlinkShort")
                  : linkParent
                    ? t(
                        "map.hierarchy.childShort",
                        allNodes.find((n) => n.id === linkParent)?.title || "",
                      )
                    : t("map.hierarchy.parentShort")}
            </p>
            {linkParent && !linkSaving && (
              <button
                type="button"
                className="map-hierarchy-reselect"
                onClick={() => {
                  setLinkParent(null);
                  setLinkError("");
                }}
              >
                {t("map.hierarchy.changeParent")}
              </button>
            )}
            {linkMessage && <p role="status">{linkMessage}</p>}
            {linkError && <p role="alert">{linkError}</p>}
          </div>
        )}
      </div>
      {data.nodes.length === 0 && !resultsPending && (
        <div className="empty map-empty">
          <Search />
          <h3>{t("m089")}</h3>
          <p>{t("m090")}</p>
          {onClearFilters && (
            <button className="primary-button" onClick={onClearFilters}>
              {t("workspace.clearFilters")}
            </button>
          )}
        </div>
      )}
      {mode === "3d" ? (
        <MapBoundary key="3d">
          <Suspense
            fallback={
              <div className="empty">
                <LoaderCircle className="spin" />
                {t("m091")}
              </div>
            }
          >
            <Graph3D
              data={data}
              size={size}
              selected={selected}
              onSelect={click}
              onDrag={dragNode}
              onDragEnd={endDrag}
              dragDisabled={dragDisabled || linkMode !== "browse"}
              relations={relations && linkMode !== "unlink"}
              editingLinks={linkMode !== "browse"}
              graphRef={graphRef}
            />
          </Suspense>
        </MapBoundary>
      ) : (
        <ForceGraph2D
          ref={graphRef}
          graphData={data}
          width={size.width}
          height={size.height}
          backgroundColor="#11151c00"
          nodeLabel={label}
          cooldownTicks={0}
          enableNodeDrag={!dragDisabled && linkMode === "browse"}
          onNodeDrag={(node) => dragNode(node, data.nodes)}
          onNodeDragEnd={(node) => endDrag(node, data.nodes)}
          minZoom={0.002}
          maxZoom={20}
          onRenderFramePre={(ctx, scale) => {
            const graph = graphRef.current;
            if (!graph) return;
            const candidates = [];
            const eligible = new Set(
              data.nodes
                .filter((n) => labelEligible(n, scale, selected, hover))
                .map((n) => n.id),
            );
            for (const node of data.nodes) {
              if (!eligible.has(node.id)) continue;
              const { label } = mapNodeGeometry(
                node,
                ctx,
                scale,
                selected,
                hover,
                eligible,
              );
              const [x, y, w, h] = label.box,
                point = graph.graph2ScreenCoords(x, y);
              candidates.push({
                node,
                box: [point.x, point.y, w * scale, h * scale],
              });
            }
            visibleLabels.current = declutterLabels(
              candidates,
              size.width,
              size.height,
              selected,
              hover,
            );
          }}
          onNodeClick={(_, event) => select2DAtClick(event)}
          onLinkClick={(link, event) => select2DAtClick(event, link)}
          onBackgroundClick={select2DAtClick}
          showPointerCursor={(node) =>
            !!node?.id || (linkMode === "unlink" && node?.kind === "tree")
          }
          onNodeHover={(n) => setHover(n?.id)}
          linkVisibility={(l) =>
            (relations && linkMode !== "unlink") || l.kind === "tree"
          }
          linkHoverPrecision={linkMode === "unlink" ? 10 : 4}
          linkDirectionalArrowLength={(l) =>
            l.kind === "tree" ? 8 / (graphRef.current?.zoom() || 1) : 0
          }
          linkDirectionalArrowRelPos={0.5}
          linkDirectionalArrowColor={(l) => l.color}
          linkColor={(l) =>
            l.kind === "related" ? "#7686a060" : `${l.color}60`
          }
          linkWidth={(l) => (l.kind === "tree" ? 1.25 : 0.8)}
          linkLineDash={(l) => (l.kind === "related" ? [4, 5] : null)}
          nodeCanvasObject={(node, ctx, scale) => {
            const { active, hovered, label } = mapNodeGeometry(
              node,
              ctx,
              scale,
              selected,
              hover,
              visibleLabels.current,
            );
            ctx.save();
            ctx.globalAlpha = node.context
              ? 0.3
              : node.r * scale > 80 && !active && !hovered
                ? 0.2
                : 1;
            const r = Math.max(node.r, 0.8 / scale);
            if (active || hovered) {
              ctx.beginPath();
              ctx.arc(node.x, node.y, r + 7, 0, 2 * Math.PI);
              ctx.fillStyle = `${node.color}15`;
              ctx.fill();
              ctx.strokeStyle = `${node.color}80`;
              ctx.lineWidth = 1 / scale;
              ctx.stroke();
            }
            const gradient = ctx.createRadialGradient(
              node.x - r * 0.3,
              node.y - r * 0.35,
              0,
              node.x,
              node.y,
              r,
            );
            gradient.addColorStop(0, node.color);
            gradient.addColorStop(1, `${node.color}92`);
            ctx.beginPath();
            ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
            ctx.fillStyle = gradient;
            ctx.shadowColor = node.color;
            ctx.shadowBlur = active ? 22 : node.depth < 2 ? 12 : 0;
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.beginPath();
            ctx.arc(
              node.x - r * 0.22,
              node.y - r * 0.26,
              r * 0.18,
              0,
              2 * Math.PI,
            );
            ctx.fillStyle = "#ffffff30";
            ctx.fill();
            if (label) {
              ctx.font = label.font;
              ctx.textAlign = label.align;
              ctx.textBaseline = "top";
              ctx.fillStyle = "#11151ce8";
              ctx.fillRect(...label.box);
              ctx.fillStyle = active
                ? "#ffffff"
                : node.depth <= 1
                  ? "#e6eaf2"
                  : "#a7afbe";
              ctx.fillText(label.title, label.x, label.y);
            }
            ctx.restore();
          }}
          nodePointerAreaPaint={(n, color, ctx, scale) =>
            paintMapNodePointer(
              n,
              color,
              ctx,
              scale,
              selected,
              hover,
              visibleLabels.current,
            )
          }
        />
      )}
    </div>
  );
}
