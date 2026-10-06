import { release } from "../shared/release.js";
import {
  t,
  locale,
  getLanguage,
  setLanguage,
  subscribeLanguage,
  localizeMessage,
} from "../shared/i18n.js";
import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  lazy,
  Suspense,
} from "react";
import { createRoot } from "react-dom/client";
import { MarkdownContent as Md } from "./markdown.jsx";
import { useMapPositions } from "./use-map-positions.js";
import {
  Network,
  Search,
  Plus,
  ChevronRight,
  ChevronDown,
  X,
  Folder,
  Code2,
  BookOpen,
  Layers3,
  Box,
  GitBranch,
  Maximize,
  Minus,
  ArrowUpRight,
  Download,
  Upload,
  RefreshCw,
  Pencil,
  Check,
  Copy,
  Archive,
  PanelLeftClose,
  Menu,
  FileText,
  Link2,
  Circle,
  Sparkles,
  List,
  LoaderCircle,
  ExternalLink,
  Wrench,
} from "lucide-react";
import "./style.css";
import "./readability.css";
import "./extensions.css";
import "./v2.css";
import "./scrollbars.css";
import "./tools.css";
import { DataTools } from "./data-tools.jsx";
import { ResizableWorkspace } from "./resizable-workspace.jsx";
import "./backups.css";
import { BackupTransferPanel } from "./backup-transfer-panel.jsx";
import { IndexProgress } from "./index-progress.jsx";
import { backupTransfer } from "./backup-transfer.js";
import { UploadRecovery } from "./upload-recovery.jsx";
import { LanguageSetup } from "./language-setup.jsx";
import { api, useDialogKeys } from "./client.js";
import { UndoControls } from "./undo-controls.jsx";
import {
  useDraft,
  DraftNotice,
  DraftExit,
  ConflictReview,
  setDraftLibrary,
} from "./drafts.jsx";
import { validateNode } from "../shared/schema.js";
import {
  recordImportance,
  importancePriority,
  withImportance,
} from "../shared/importance.js";
import { ImportanceStars, RecordImportance } from "./importance.jsx";
import { ListSort, RecordStamp, RecordOrder } from "./record-list.jsx";
import { LIST_SORTS, sortRecords } from "../shared/record-list.js";
import { CheckpointEditor, TaskCheckpoints } from "./checkpoints.jsx";
import { InventoryEditor } from "./inventory-editor.jsx";
import { itemQuantity, itemPlaces } from "../shared/inventory.js";
import { StockMovements } from "./stock-movements.jsx";
import {
  LocationsSettings,
  ResourceEditor,
  ResourceList,
} from "./locations.jsx";
import { DocumentViewer } from "./documents.jsx";
import { AttachmentGallery } from "./journal.jsx";
import { JournalNotebook } from "./journal-notebook.jsx";
import { MAP_LAYOUTS, mapGraph } from "./map-layout.js";
import {
  useMapLayout,
  readMapLayout,
  saveMapLayout,
} from "./use-map-layout.js";
import "./map-layout.css";
import { Inventory, Tasks } from "./work-views.jsx";
import { TASK_STATUS, PRIORITIES, projectFor } from "./work-model.js";
import {
  atlasStructure,
  descendants,
  matchesQuery,
  filterNodes,
} from "./atlas-model.js";
import { createAtlasSync } from "./atlas-sync.js";
import { Breadcrumbs } from "./breadcrumbs.jsx";
import { createRecordNavigation } from "./breadcrumb-model.js";
const TaskDialog = lazy(() => import("./task-dialog.jsx"));
const MapView = lazy(() => import("./map-view.jsx"));
const WorkTools = lazy(() =>
  import("./work-tools.jsx").then((module) => ({ default: module.WorkTools })),
);
const EMPTY_NODES = [];
const EMPTY_GRAPH = { nodes: [], links: [], matchCount: 0 };
const TYPES = {
  get category() {
    return t("m390");
  },
  get project() {
    return t("m391");
  },
  get knowledge() {
    return t("m392");
  },
  get skill() {
    return t("m393");
  },
  get code() {
    return t("m077");
  },
  get item() {
    return t("m078");
  },
  get task() {
    return t("m079");
  },
};
const STATUS = {
  get draft() {
    return t("m080");
  },
  get learning() {
    return t("m081");
  },
  get active() {
    return t("m082");
  },
  get done() {
    return t("m083");
  },
};
const ICONS = {
  category: Layers3,
  project: Folder,
  knowledge: BookOpen,
  skill: Sparkles,
  code: Code2,
  item: Box,
  task: Check,
};
const COLORS = [
  "#a7e87b",
  "#73c8ed",
  "#c3a0f3",
  "#f1bb73",
  "#f090b2",
  "#93a9fd",
];
function Glyph({ type, ...props }) {
  const Icon = ICONS[type] || Circle;
  return <Icon size={17} {...props} />;
}
function App() {
  const language = React.useSyncExternalStore(subscribeLanguage, getLanguage);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = `${release.name} · ${t("m099")}`;
  }, [language]);
  const [settings, setSettings] = useState({
      locations: [],
    }),
    [showSettings, setShowSettings] = useState(false),
    [openDocument, setDocument] = useState(null);
  const [nodes, setNodes] = useState([]),
    [errors, setErrors] = useState([]),
    [orderRevision, setOrderRevision] = useState(""),
    [mapPositions, setMapPositions] = useState({ views: {} }),
    [undoState, setUndoState] = useState(null),
    [mapReset, setMapReset] = useState(0),
    [env, setEnv] = useState({}),
    [loading, setLoading] = useState(true),
    [snapshotContent, setSnapshotContent] = useState(""),
    [mapRequested, setMapRequested] = useState(false),
    [indexProgress, setIndexProgress] = useState(null),
    [error, setError] = useState("");
  const [selected, setSelected] = useState(
      () => decodeURIComponent(location.hash.slice(1)) || "",
    ),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [scope, setScope] = useState(""),
    [mode, setMode] = useState("2d"),
    [mapLayout, setMapLayout] = useState(readMapLayout),
    [importanceFilter, setImportanceFilter] = useState([]),
    [listSort, setListSort] = useState(() => {
      try {
        const saved = localStorage.getItem("atlas-list-sort");
        return LIST_SORTS.includes(saved) ? saved : "order";
      } catch {
        return "order";
      }
    }),
    [view, setView] = useState(() => {
      const chosen = new URLSearchParams(location.search).get("view");
      return [
        "map",
        "library",
        "tasks",
        "inventory",
        "tools",
        "journal",
        "backups",
      ].includes(chosen)
        ? chosen
        : "tasks";
    }),
    [relations, setRelations] = useState(true),
    [expanded, setExpanded] = useState(new Set()),
    [sidebar, setSidebar] = useState(false),
    [detail, setDetail] = useState(
      () => new URLSearchParams(location.search).get("view") === "library",
    ),
    [editing, setEditing] = useState(null),
    [reader, setReader] = useState(null),
    [toast, setToast] = useState(""),
    [toolProject, setToolProject] = useState(""),
    [journalCreate, setJournalCreate] = useState(false);
  const content =
    view === "journal" && !showSettings
      ? "journal"
      : view === "map" && mapRequested
        ? "map"
        : (view !== "map" && detail) ||
            showSettings ||
            ["library", "inventory", "tools"].includes(view)
          ? "records"
          : "tasks";
  const snapshotReady =
    !!snapshotContent &&
    ((content === "tasks" && snapshotContent !== "journal") ||
      snapshotContent === content ||
      (content === "journal" && ["records", "map"].includes(snapshotContent)) ||
      (content === "records" && snapshotContent === "map"));
  const mapActive = view === "map" && mapRequested && snapshotContent === "map";
  const showDetail =
    view !== "journal" && detail && (view !== "map" || mapRequested);
  const graphRef = useRef(),
    importRef = useRef(),
    searchRef = useRef(),
    syncRef = useRef();
  const notify = (message) => {
    setToast(message);
    setTimeout(() => setToast(""), 4500);
  };
  const load = () => syncRef.current?.refresh({ fresh: true });
  useEffect(() => {
    setLoading(!snapshotReady);
    const sync = createAtlasSync({
      url:
        content === "map"
          ? "./api/atlas"
          : `./api/workspace?content=${content}`,
      isVisible: () => document.visibilityState !== "hidden",
      onIndex: (progress) =>
        setIndexProgress({ ...progress, receivedAt: Date.now() }),
      onSnapshot: (r) => {
        setSnapshotContent(r.content);
        setDraftLibrary(r.settings.libraryId);
        setLanguage(r.settings.language);
        setNodes(r.nodes);
        setOrderRevision(r.orderRevision);
        if (r.mapPositions) setMapPositions(r.mapPositions);
        setUndoState(r.undo || null);
        setErrors(r.errors);
        setEnv(r.environment);
        setSettings(r.settings);
      },
      onHealthy: () => {
        setError("");
        setLoading(false);
      },
      onError: (error) => {
        setError(error.name === "TimeoutError" ? t("sync.timeout") : t("m092"));
        setLoading(false);
      },
    });
    syncRef.current = sync;
    sync.start();
    const resume = () => {
      if (document.visibilityState !== "hidden") sync.refresh();
    };
    const hash = () =>
      setSelected(decodeURIComponent(location.hash.slice(1)) || "");
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("hashchange", hash);
    return () => {
      sync.stop();
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("hashchange", hash);
    };
  }, [content]);
  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set("view", view);
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, [view]);
  const structure = useMemo(() => atlasStructure(nodes), [nodes]);
  const { homeId, stats } = structure;
  useEffect(() => {
    if (loading || errors.length) return;
    if (!nodes.some((n) => n.id === selected)) {
      setSelected(homeId);
      history.replaceState(
        null,
        "",
        `${location.pathname}${location.search}${homeId ? "#" + encodeURIComponent(homeId) : ""}`,
      );
    }
    if (scope && !structure.categories.some((n) => n.id === scope))
      setScope("");
  }, [nodes, loading, errors, selected, scope, homeId]);
  useEffect(() => {
    if (!editing && !reader) return;
    const previous = document.activeElement;
    const handle = (e) => {
      if (e.key === "Escape" && reader) {
        setReader(null);
        return;
      }
      if (e.key !== "Tab") return;
      const dialog = [...document.querySelectorAll('[role="dialog"]')].at(-1);
      const items = [
        ...dialog.querySelectorAll(
          "button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary",
        ),
      ].filter((el) => el.getClientRects().length);
      if (!items.length) return;
      const first = items[0],
        last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      previous?.focus?.();
    };
  }, [!!editing, !!reader]);
  useEffect(() => {
    const fn = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") {
        setSidebar(false);
      }
    };
    document.addEventListener("keydown", fn);
    return () => document.removeEventListener("keydown", fn);
  }, []);
  const node = nodes.find((n) => n.id === selected);
  const groups = structure.categories;
  const mapNodes = mapActive ? nodes : EMPTY_NODES;
  const layoutState = useMapLayout(mapNodes, mapLayout, mode, mapActive);
  const manualMap = useMapPositions(
    mapNodes,
    layoutState.positions,
    mapPositions,
    `${mapLayout}:${mode === "3d" ? 3 : 2}`,
    load,
  );
  const graph = useMemo(
    () =>
      mapActive
        ? mapGraph(nodes, manualMap.positions, {
            scope,
            query,
            type: filter,
            importance: importanceFilter,
            locations: settings.locations,
          })
        : EMPTY_GRAPH,
    [
      mapActive,
      nodes,
      manualMap.positions,
      scope,
      query,
      filter,
      importanceFilter,
      settings.locations,
    ],
  );
  const choose = (n) => {
    const id = typeof n === "string" ? n : n.id;
    const record = nodes.find((item) => item.id === id);
    if (record?.type === "task" && view !== "map") {
      setEditing(record);
      return;
    }
    setSelected(id);
    location.hash = encodeURIComponent(id);
    setDetail(true);
    setSidebar(false);
  };
  const openNodeDocument = (picked) => {
    const current = nodes.find((n) => n.id === picked.id);
    if (!current) return;
    const resource = current.resources.find(
      (r) => r.id === current.previewResourceId,
    );
    if (resource)
      setDocument({
        nodeId: current.id,
        resourceId: resource.id,
        title: resource.label,
      });
    else setReader({ nodeId: current.id });
  };
  const newNode = (
    parent,
    type = "knowledge",
    status = "draft",
    projectId = "",
    columnId,
  ) =>
    setEditing({
      schema: 1,
      title: "",
      type,
      status,
      parent: parent || null,
      color: nodes.find((n) => n.id === parent)?.color || COLORS[0],
      summary: "",
      tags: [],
      related: [],
      resources: [],
      body: t("m093"),
      ...(type === "item"
        ? {
            stock: {
              mode: "unique",
              placements: [
                {
                  id: crypto.randomUUID(),
                  locationId: "",
                  detail: "",
                  quantity: 1,
                },
              ],
            },
          }
        : {}),
      ...(type === "task"
        ? {
            projectId,
            task: {
              ...(columnId ? { columnId } : {}),
              start: "",
              due: "",
              priority: "normal",
              assignee: "",
            },
          }
        : {}),
    });
  const orderedNodes = useMemo(
    () => sortRecords(nodes, listSort),
    [nodes, listSort],
  );
  const changeListSort = (value) => {
    setListSort(value);
    try {
      localStorage.setItem("atlas-list-sort", value);
    } catch {}
  };
  const tree = useMemo(() => {
    const children = new Map();
    for (const n of orderedNodes) {
      if (!children.has(n.parent)) children.set(n.parent, []);
      children.get(n.parent).push(n);
    }
    const rows = [],
      stack = (children.get(null) || [])
        .map((n) => ({
          n,
          depth: 0,
        }))
        .reverse(),
      seen = new Set();
    while (stack.length) {
      const row = stack.pop();
      if (seen.has(row.n.id)) continue;
      seen.add(row.n.id);
      rows.push({
        ...row,
        hasChildren: !!children.get(row.n.id)?.length,
      });
      if (expanded.has(row.n.id))
        for (const n of [...(children.get(row.n.id) || [])].reverse())
          stack.push({
            n,
            depth: row.depth + 1,
          });
    }
    return rows;
  }, [orderedNodes, expanded]);
  const recordNavigation = useMemo(
    () => createRecordNavigation(nodes),
    [nodes],
  );
  const breadcrumb = recordNavigation.path(selected);
  const sections = [
    ["map", t("m101")],
    ["library", t("m102")],
    ["tasks", t("m103")],
    ["inventory", t("m104")],
    ["tools", t("tools.title")],
    ["journal", t("journal.title")],
    ["settings", t("m029")],
    ["backups", t("backup.title")],
  ].map(([id, label]) => ({
    id: "section:" + id,
    label,
    target: { kind: "section", id },
  }));
  const recordChoice = (record, kind = "record") => ({
    id: "record:" + record.id,
    label: record.title,
    target: { kind, id: record.id },
  });
  const recordCrumbs = (path, kind = "record") =>
    path.map((record) => ({
      ...recordChoice(record, kind),
      choices: recordNavigation
        .siblings(record.id)
        .map((sibling) => recordChoice(sibling, kind)),
    }));
  const section = sections.find((item) => item.id === "section:" + view);
  const showRecordPath = showDetail && node && view !== "backups";
  const topPath = [
    {
      id: "workspace",
      label: t("m117"),
      target: { kind: "section", id: "tasks" },
      choices: sections,
      activeId: section.id,
      menuLabel: t("navigation.sections"),
    },
    { ...section, choices: sections, menuLabel: t("navigation.sections") },
    ...recordCrumbs(
      showRecordPath
        ? breadcrumb
        : view !== "backups"
          ? recordNavigation.path(scope)
          : [],
      showRecordPath ? "record" : "scope",
    ),
  ];
  function navigatePath(target) {
    setQuery("");
    setFilter("all");
    setImportanceFilter([]);
    setSidebar(false);
    if (target.kind === "section") {
      if (target.id === "settings") {
        setShowSettings(true);
        return;
      }
      setView(target.id);
      setScope("");
      setToolProject("");
      setSelected(homeId);
      location.hash = homeId ? encodeURIComponent(homeId) : "";
      setDetail(false);
      return;
    }
    const destination = nodes.find((record) => record.id === target.id);
    if (!destination) return;
    if (target.kind === "scope" && destination.type === "category") {
      setScope(
        destination.id === structure.container?.id ? "" : destination.id,
      );
      setDetail(false);
      return;
    }
    setScope("");
    if (!["map", "library"].includes(view)) setView("library");
    choose(destination);
  }
  const related = node
    ? nodes.filter(
        (n) => node.related.includes(n.id) || n.related.includes(node.id),
      )
    : [];
  async function archive() {
    if (!confirm(t("m094", node.title))) return;
    try {
      await api(`nodes/${node.id}`, {
        method: "DELETE",
        body: JSON.stringify({
          revision: node.revision,
        }),
      });
      choose(node.parent || homeId);
      await load();
      notify(t("m095"));
    } catch (e) {
      notify(e.message);
    }
  }
  const matched = useMemo(
    () =>
      filterNodes(orderedNodes, {
        scope,
        query,
        type: filter,
        importance: importanceFilter,
        locations: settings.locations,
      }),
    [orderedNodes, scope, query, filter, importanceFilter, settings],
  );
  const liveReader = reader?.nodeId
    ? nodes.find((n) => n.id === reader.nodeId)
    : null;
  const readerContent = reader?.nodeId
    ? liveReader || {
        title: t("m096"),
        body: t("m097"),
      }
    : reader;
  if (
    !loading &&
    settings.languageSelectionCompleted === false &&
    !settings.invalid
  )
    return (
      <LanguageSetup
        settings={settings}
        onSaved={(saved) => {
          setSettings(saved);
          setLanguage(saved.language);
          load();
        }}
      />
    );
  return (
    <div className="app">
      {sidebar && (
        <div className="side-backdrop" onClick={() => setSidebar(false)} />
      )}
      <aside className={`sidebar ${sidebar ? "open" : ""}`}>
        <a
          className="brand"
          href={homeId ? `#${encodeURIComponent(homeId)}` : "#"}
          onClick={(event) => {
            event.preventDefault();
            setView("tasks");
            setDetail(false);
            setSidebar(false);
          }}
        >
          <img
            className="brand-logo"
            src="./app-logo.svg"
            alt=""
            width="40"
            height="40"
          />
          <span>
            {release.name}
            <small>{t("m099")}</small>
          </span>
        </a>
        <div className="workspace-label">{t("m100")}</div>
        <button
          className={`nav-button ${view === "map" ? "active" : ""}`}
          onClick={() => {
            setView("map");
            if (!mapRequested) setDetail(false);
            setSidebar(false);
          }}
        >
          <Network size={18} />
          {t("m101")}
          <span className="nav-badge">{nodes.length}</span>
        </button>
        <button
          className={`nav-button ${view === "library" ? "active" : ""}`}
          onClick={() => {
            setView("library");
            setSidebar(false);
          }}
        >
          <BookOpen size={18} />
          {t("m102")}
        </button>
        <button
          className={`nav-button ${view === "tasks" ? "active" : ""}`}
          onClick={() => {
            setView("tasks");
            setDetail(false);
            setSidebar(false);
          }}
        >
          <Check size={18} />
          {t("m103")}
          <span className="nav-badge">{stats.tasks}</span>
        </button>
        <button
          className={`nav-button ${view === "inventory" ? "active" : ""}`}
          onClick={() => {
            setView("inventory");
            setDetail(false);
            setSidebar(false);
          }}
        >
          <Box size={18} />
          {t("m104")}
          <span className="nav-badge">{stats.items}</span>
        </button>
        <button
          className={`nav-button ${view === "journal" ? "active" : ""}`}
          onClick={() => {
            setView("journal");
            setDetail(false);
            setSidebar(false);
          }}
        >
          <BookOpen size={18} />
          {t("journal.title")}
          <span className="nav-badge">
            {nodes.filter((n) => n.tool?.kind === "journal").length}
          </span>
        </button>
        <button
          className={`nav-button ${view === "tools" ? "active" : ""}`}
          onClick={() => {
            setView("tools");
            setToolProject("");
            setDetail(false);
            setSidebar(false);
          }}
        >
          <Wrench size={18} />
          {t("tools.title")}
          <span className="nav-badge">{stats.tools}</span>
        </button>
        <button
          className="nav-button"
          onClick={() => {
            setShowSettings(true);
            setSidebar(false);
          }}
        >
          <Folder size={18} />
          {t("m029")}
        </button>
        <button
          className={`nav-button ${view === "backups" ? "active" : ""}`}
          onClick={() => {
            setView("backups");
            setDetail(false);
            setSidebar(false);
          }}
        >
          <Download size={18} />
          {t("backup.title")}
        </button>
        <div className="tree-heading">
          <span>{t("m105")}</span>
          <button
            className="icon-button"
            aria-label={t("m106")}
            onClick={() =>
              setEditing({
                schema: 1,
                title: "",
                type: "category",
                status: "draft",
                parent: structure.container?.id || null,
                color: COLORS[groups.length % 6],
                summary: "",
                tags: [],
                related: [],
                resources: [],
                body: "",
              })
            }
          >
            <Plus size={16} />
          </button>
        </div>
        <nav className="tree" aria-label={t("m107")}>
          {tree.map(({ n, depth, hasChildren }) => (
            <div
              key={n.id}
              className={`tree-row ${selected === n.id ? "selected" : ""}`}
              style={{
                paddingLeft: 12 + Math.min(depth, 8) * 13,
              }}
            >
              <button
                className={`tree-toggle ${!hasChildren ? "invisible" : ""}`}
                aria-expanded={hasChildren ? expanded.has(n.id) : undefined}
                aria-label={`${!expanded.has(n.id) ? t("m395") : t("m396")} ${n.title}`}
                onClick={() =>
                  setExpanded((old) => {
                    const next = new Set(old);
                    next.has(n.id) ? next.delete(n.id) : next.add(n.id);
                    return next;
                  })
                }
              >
                {!expanded.has(n.id) ? (
                  <ChevronRight size={13} />
                ) : (
                  <ChevronDown size={13} />
                )}
              </button>
              <button
                className="tree-title"
                onClick={() => choose(n)}
                title={n.title}
              >
                <span
                  className="branch-dot"
                  style={{
                    background: n.color,
                  }}
                />
                {n.title}
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="storage-note">
            <span className="file-icon">
              <FileText size={18} />
            </span>
            <div>
              {t("m108")}
              <small>{t("m109")}</small>
            </div>
          </div>
          <div className="sidebar-actions">
            <button
              onClick={() => {
                setView("backups");
                if (!backupTransfer.active) backupTransfer.start("download");
              }}
            >
              <Download size={15} />
              {t("m110")}
            </button>
            <button onClick={() => importRef.current.click()}>
              <Upload size={15} />
              {t("m111")}
            </button>
          </div>
          <div className="profile">
            <span>{t("m112")}</span>
            <div>
              {t("m113")}
              <small>{env.ingress ? "Home Assistant" : t("m114")}</small>
            </div>
            <span className="version">
              {t("m115")}
              {env.version || release.version}
            </span>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu"
              aria-label={t("m116")}
              onClick={() => setSidebar(true)}
            >
              <Menu size={21} />
            </button>
            <Breadcrumbs
              items={topPath}
              label={t("navigation.path")}
              onNavigate={navigatePath}
            />
          </div>
          <div className="topbar-actions">
            <UndoControls
              remote={undoState}
              onChanged={load}
              disabled={
                loading ||
                !!editing ||
                !!reader ||
                !!openDocument ||
                showSettings ||
                manualMap.saving ||
                !!manualMap.error
              }
            />
            <span className="local-status">
              <FileText size={14} />
              {env.ingress ? t("m397") : t("m118")}
            </span>
            <button
              className="icon-button"
              title={t("m119")}
              aria-label={t("m119")}
              onClick={load}
            >
              <RefreshCw size={17} />
            </button>
            <button
              className="primary-button"
              onClick={() =>
                view === "journal"
                  ? setJournalCreate(true)
                  : newNode(
                      selected || homeId,
                      view === "tasks"
                        ? "task"
                        : view === "inventory"
                          ? "item"
                          : "knowledge",
                    )
              }
            >
              <Plus size={17} />
              {view === "journal" ? t("tools.new.journal") : t("m120")}
            </button>
          </div>
        </header>
        <section className="page-heading">
          <div>
            <h1>
              {
                {
                  map: t("m101"),
                  library: t("m102"),
                  tasks: t("m103"),
                  inventory: t("m104"),
                  tools: t("tools.title"),
                  journal: t("journal.title"),
                  backups: t("backup.title"),
                }[view]
              }
            </h1>
            <p>
              {
                {
                  map: t("m126"),
                  library: t("m127"),
                  tasks: t("m128"),
                  inventory: t("m129"),
                  tools: t("tools.description"),
                  journal: t("journal.description"),
                  backups: t("backup.description"),
                }[view]
              }
            </p>
          </div>
          <div className="stats" aria-label={t("m130")}>
            <div>
              <strong>{stats.projects}</strong>
              <span>{t("m131")}</span>
            </div>
            <div>
              <strong>{stats.notes}</strong>
              <span>{t("m132")}</span>
            </div>
            <div>
              <strong>
                {view === "inventory"
                  ? stats.items
                  : view === "tasks"
                    ? stats.tasks
                    : view === "tools"
                      ? stats.tools
                      : stats.areas}
              </strong>
              <span>
                {view === "inventory"
                  ? t("m133")
                  : view === "tasks"
                    ? t("m134")
                    : view === "tools"
                      ? t("tools.records")
                      : t("m135")}
              </span>
            </div>
          </div>
        </section>
        <section
          className={`workbench ${view === "backups" ? "backup-workbench" : ""} ${view === "map" && !mapRequested ? "map-locked" : ""}`}
        >
          <div className="toolbar">
            <label className="search">
              <Search size={17} />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("m136")}
                aria-label={t("m137")}
              />
              <kbd>{t("m138")}</kbd>
            </label>
            <select
              aria-label={t("m139")}
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="">{t("m140")}</option>
              {groups.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
            </select>
            {view !== "backups" && (
              <fieldset className="importance-filter">
                <legend>{t("importance.label")}</legend>
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-label={t("map.importanceExact", value)}
                    aria-pressed={importanceFilter.includes(value)}
                    className={
                      importanceFilter.includes(value) ? "selected" : ""
                    }
                    onClick={() =>
                      setImportanceFilter((old) =>
                        old.includes(value)
                          ? old.filter((n) => n !== value)
                          : [...old, value],
                      )
                    }
                  >
                    {value}
                    <span aria-hidden="true">★</span>
                  </button>
                ))}
                <button
                  type="button"
                  aria-pressed={!importanceFilter.length}
                  onClick={() => setImportanceFilter([])}
                >
                  {t("m144")}
                </button>
              </fieldset>
            )}
            {["library", "tasks", "inventory"].includes(view) && (
              <ListSort value={listSort} onChange={changeListSort} />
            )}
            <div className="toolbar-spacer" />
            {view === "map" && (
              <select
                aria-label={t("map.layout")}
                aria-describedby="map-layout-description"
                className="map-layout-select"
                title={t("map.layoutHelp")}
                value={mapLayout}
                onChange={(e) => {
                  setMapLayout(e.target.value);
                  saveMapLayout(e.target.value);
                }}
              >
                {MAP_LAYOUTS.map((name, index) => (
                  <option key={name} value={name}>
                    {index + 1}. {t(`map.layout.${name}`)}
                  </option>
                ))}
              </select>
            )}
            {view === "map" && (
              <div className="segmented">
                <button
                  className={mode === "2d" ? "active" : ""}
                  onClick={() => setMode("2d")}
                >
                  <Network size={15} />
                  {t("m141")}
                </button>
                <button
                  className={mode === "3d" ? "active" : ""}
                  onClick={() => setMode("3d")}
                >
                  <Box size={15} />
                  {t("m142")}
                </button>
              </div>
            )}
            {view !== "journal" && (
              <button
                className="icon-button"
                disabled={view === "map" && !mapRequested}
                aria-label={detail ? t("m143") : t("m398")}
                onClick={() => setDetail(!detail)}
              >
                <PanelLeftClose size={18} />
              </button>
            )}
          </div>
          {view === "map" && (
            <p className="map-layout-description" id="map-layout-description">
              {t(`map.layoutDescription.${mapLayout}`)}
            </p>
          )}
          <div
            className={`filter-bar ${["inventory", "tasks", "tools", "journal", "backups"].includes(view) ? "hidden-filter" : ""}`}
          >
            <button
              className={filter === "all" ? "selected" : ""}
              onClick={() => setFilter("all")}
            >
              {t("m144") + " "}
              <span>{nodes.length}</span>
            </button>
            {[
              ...Object.entries(TYPES),
              ["journal", t("journal.title")],
              ["experience", t("journal.experience")],
            ].map(([key, label]) => (
              <button
                key={key}
                className={filter === key ? "selected" : ""}
                onClick={() => setFilter(key)}
              >
                <Glyph type={key} />
                {label}
              </button>
            ))}
            {view === "map" && (
              <span className="filter-caption">
                {graph.matchCount}
                {" " + t("m145")}
                {graph.nodes.length > graph.matchCount && (
                  <small>
                    {" "}
                    · {t("map.context", graph.nodes.length - graph.matchCount)}
                  </small>
                )}
              </span>
            )}
          </div>
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button onClick={load}>{t("m146")}</button>
            </div>
          )}
          <IndexProgress state={indexProgress} />
          {errors.length > 0 && (
            <div className="error-banner" role="alert">
              <strong>{t("m147")}</strong>
              {errors.map((e, i) => (
                <p key={i}>
                  {e.file}: {localizeMessage(e.message)}
                </p>
              ))}
            </div>
          )}
          <ResizableWorkspace detail={showDetail}>
            <div className="map-area">
              {view === "map" && !mapRequested ? (
                <div className="map-download-gate">
                  <button
                    className="map-download-button"
                    onClick={() => setMapRequested(true)}
                  >
                    <span className="map-download-orbit" aria-hidden="true">
                      <Network size={48} />
                      <Download size={24} />
                    </span>
                    <strong>{t("map.download")}</strong>
                    <span>{t("map.downloadHint")}</span>
                  </button>
                </div>
              ) : loading ? (
                <div className="empty" role="status">
                  <LoaderCircle className="spin" />
                  {content === "map"
                    ? t("map.downloading")
                    : t("sync.loadingWorkspace")}
                </div>
              ) : !snapshotReady && view !== "backups" ? (
                <div className="empty" role="status">
                  <LoaderCircle className="spin" />
                  {t("sync.waiting")}
                </div>
              ) : view === "backups" ? (
                <div className="backup-page">
                  <DataTools backupOnly onChanged={load} />
                </div>
              ) : view === "journal" ? (
                <JournalNotebook
                  nodes={nodes}
                  settings={settings}
                  query={query}
                  scope={scope}
                  importance={importanceFilter}
                  homeId={homeId}
                  onRefresh={load}
                  focusId={node?.tool?.kind === "journal" ? node.id : ""}
                  createRequested={journalCreate}
                  onCreated={() => setJournalCreate(false)}
                  onSelect={(n) => {
                    choose(n);
                    setView(n.type === "task" ? "tasks" : "library");
                  }}
                />
              ) : view === "tools" ? (
                <Suspense
                  fallback={
                    <div className="empty" role="status">
                      <LoaderCircle className="spin" />
                      {t("sync.loadingWorkspace")}
                    </div>
                  }
                >
                  <WorkTools
                    importance={importanceFilter}
                    nodes={nodes}
                    settings={settings}
                    query={query}
                    scope={scope}
                    homeId={homeId}
                    initialProject={toolProject}
                    focusId={
                      nodes.find((n) => n.id === selected)?.tool ? selected : ""
                    }
                    onRefresh={load}
                    onSelect={(n) => {
                      if (n) {
                        choose(n);
                        setView("library");
                      }
                    }}
                  />
                </Suspense>
              ) : view === "inventory" ? (
                <Inventory
                  importance={importanceFilter}
                  nodes={orderedNodes}
                  settings={settings}
                  query={query}
                  scope={scope}
                  onSelect={choose}
                  onNew={() => newNode(scope || homeId, "item")}
                />
              ) : view === "tasks" ? (
                <Tasks
                  importance={importanceFilter}
                  onRefresh={load}
                  nodes={orderedNodes}
                  settings={settings}
                  query={query}
                  scope={scope}
                  onSelect={choose}
                  orderRevision={orderRevision}
                  onEdit={(n, tab) => setEditing({ ...n, _tab: tab })}
                  onNew={(project = "", status = "draft", columnId) =>
                    newNode(
                      project || scope || homeId,
                      "task",
                      status,
                      project,
                      columnId,
                    )
                  }
                  onMove={async (n, status) => {
                    await api(`nodes/${n.id}`, {
                      method: "PUT",
                      body: JSON.stringify({
                        ...n,
                        status,
                      }),
                    });
                    await load();
                  }}
                />
              ) : view === "map" ? (
                <>
                  <div className="map-caption">
                    <span className="tiny-line" />{" "}
                    {scope
                      ? nodes.find((n) => n.id === scope)?.title
                      : t("m149")}
                    <small>{mode === "2d" ? t("m399") : t("m150")}</small>
                  </div>
                  {layoutState.building && (
                    <div className="map-building" role="status">
                      <LoaderCircle className="spin" />
                      {t("map.building")}
                    </div>
                  )}
                  {layoutState.error && (
                    <div className="map-building" role="alert">
                      {t("map.failed")}
                    </div>
                  )}
                  <Suspense
                    fallback={
                      <div className="empty" role="status">
                        <LoaderCircle className="spin" />
                        {t("map.downloading")}
                      </div>
                    }
                  >
                    <MapView
                      data={graph}
                      key={`${mapLayout}:${mode}:${mapReset}`}
                      allNodes={nodes}
                      positions={manualMap.positions}
                      onPositions={manualMap.save}
                      dragDisabled={manualMap.disabled || layoutState.building}
                      mode={mode}
                      selected={selected}
                      onSelect={choose}
                      onOpen={openNodeDocument}
                      viewerOpen={!!reader || !!openDocument}
                      relations={relations}
                      graphRef={graphRef}
                    />
                  </Suspense>
                  <div className="map-bottom">
                    <label className="relation-toggle">
                      <input
                        type="checkbox"
                        checked={relations}
                        onChange={(e) => setRelations(e.target.checked)}
                      />
                      <Link2 size={14} />
                      {t("m151")}
                    </label>
                    <span>{t("map.dragHelp")}</span>
                    <button
                      className="secondary-button"
                      disabled={
                        manualMap.saving ||
                        mapPositions.invalid ||
                        !mapPositions.revision ||
                        layoutState.building
                      }
                      title={t("map.resetHint")}
                      onClick={() => {
                        manualMap.reset();
                        setMapReset((n) => n + 1);
                      }}
                    >
                      <RefreshCw size={15} />
                      {t("map.reset")}
                    </button>
                    <button
                      className="icon-button fit-button"
                      aria-label={t("m154")}
                      title={t("m154")}
                      onClick={() => graphRef.current?.zoomToFit(0, 65)}
                    >
                      <Maximize size={18} />
                    </button>
                  </div>
                  {(manualMap.saving || manualMap.error) && (
                    <div
                      className="map-save-status"
                      role={manualMap.error ? "alert" : "status"}
                    >
                      {manualMap.error || t("map.saving")}
                      {manualMap.error && (
                        <button
                          className="secondary-button"
                          onClick={manualMap.retry}
                        >
                          {t("map.retrySave")}
                        </button>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="library">
                  {matched.length ? (
                    matched.map((n) => (
                      <button
                        key={n.id}
                        className={`record-card ${selected === n.id ? "chosen" : ""}`}
                        onClick={() => choose(n)}
                      >
                        <span
                          className="record-icon"
                          style={{
                            color: n.color,
                            background: `${n.color}12`,
                          }}
                        >
                          <Glyph type={n.type} />
                        </span>
                        <div className="card-meta">
                          {TYPES[n.type]}
                          <span>{STATUS[n.status]}</span>
                        </div>
                        <h3 title={n.title}>{n.title}</h3>
                        <p title={n.summary}>{n.summary || t("m155")}</p>
                        <RecordStamp node={n} importance />
                        <div className="card-footer">
                          <span>
                            {nodes.find((p) => p.id === n.parent)?.title ||
                              t("m156")}
                          </span>
                          <ArrowUpRight size={17} />
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="empty">
                      <Search />
                      <h3>{t("m157")}</h3>
                      <p>{t("m158")}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
            {showDetail && (
              <aside
                id="record-details"
                className="details"
                aria-label={t("m159")}
              >
                {!snapshotReady || node?.partial ? (
                  <div className="empty" role="status">
                    <LoaderCircle className="spin" />
                    {t("m148")}
                  </div>
                ) : node ? (
                  <>
                    <RecordImportance
                      key={node.id}
                      node={node}
                      onSaved={load}
                    />
                    <div className="detail-content">
                      <AttachmentGallery node={node} settings={settings} />
                      <section className="detail-files" aria-label={t("m170")}>
                        {node.type === "item" && node.stock && (
                          <p className="physical-location">
                            {itemPlaces(node, settings.locations)}
                          </p>
                        )}
                        <div className="detail-section-title">
                          {t("m170")}
                          <span>{node.resources.length + 1}</span>
                        </div>
                        <ResourceList
                          node={node}
                          settings={settings}
                          env={env}
                          onDocument={setDocument}
                          notify={notify}
                          physicalOnly={true}
                        />
                        <button
                          className="resource record-document"
                          onClick={() => setReader({ nodeId: node.id })}
                        >
                          <FileText size={18} />
                          <div>
                            {node.file}
                            <small>
                              {node.previewResourceId
                                ? t("documents.recordMarkdown")
                                : t("documents.doubleClickTarget")}
                            </small>
                          </div>
                          <ArrowUpRight size={15} />
                        </button>
                        <ResourceList
                          node={node}
                          physicalOnly={false}
                          settings={settings}
                          env={env}
                          onDocument={setDocument}
                          notify={notify}
                        />
                      </section>
                      <div className="detail-top">
                        <span
                          className="type-label"
                          style={{
                            color: node.color,
                          }}
                        >
                          <Glyph type={node.type} />
                          {TYPES[node.type]}
                        </span>
                        <div>
                          <button
                            className="icon-button"
                            aria-label={t("m160")}
                            onClick={() => setEditing(node)}
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label={t("m161")}
                            onClick={() => setDetail(false)}
                          >
                            <X size={18} />
                          </button>
                        </div>
                      </div>
                      <Breadcrumbs
                        items={recordCrumbs(breadcrumb)}
                        label={t("navigation.recordPath")}
                        onNavigate={navigatePath}
                        className="record-path"
                      />
                      <h2>{node.title}</h2>
                      <RecordStamp node={node} />
                      <RecordOrder
                        key={node.id}
                        node={node}
                        count={nodes.length}
                        limit={nodes.reduce(
                          (max, n) => Math.max(max, n.position || 0),
                          nodes.length,
                        )}
                        revision={orderRevision}
                        onSaved={load}
                      />
                      <p className="detail-summary">{node.summary}</p>
                      {node.type === "item" && (
                        <div className="detail-extra">
                          <p>
                            <Box size={16} />
                            {itemQuantity(node)}
                            {" " + t("m162")}
                          </p>
                          {node.stock && (
                            <>
                              <StockMovements
                                key={node.id}
                                node={node}
                                settings={settings}
                                onChanged={load}
                              />
                            </>
                          )}
                        </div>
                      )}
                      {node.type === "task" && (
                        <div className="detail-extra">
                          <p>
                            {TASK_STATUS[node.status]} ·{" "}
                            {PRIORITIES[importancePriority(node)]}
                          </p>
                          <p>
                            {node.task?.start || t("m163")} →{" "}
                            {node.task?.due || t("m164")}
                          </p>
                          <TaskCheckpoints
                            key={node.id}
                            node={node}
                            allTasks={nodes.filter((n) => n.type === "task")}
                            onSaved={load}
                          />
                          {projectFor(node, nodes) && (
                            <button
                              onClick={() => choose(projectFor(node, nodes))}
                            >
                              {t("m165") + " "}
                              {projectFor(node, nodes).title} ↗
                            </button>
                          )}
                        </div>
                      )}
                      {node.type === "project" && (
                        <button
                          className="secondary-button project-task-button"
                          onClick={() =>
                            newNode(node.id, "task", "draft", node.id)
                          }
                        >
                          <Plus size={15} />
                          {t("m166")}
                        </button>
                      )}
                      {(node.type === "project" || node.tool) && (
                        <button
                          className="secondary-button project-task-button"
                          onClick={() => {
                            setView(
                              node.tool?.kind === "journal"
                                ? "journal"
                                : "tools",
                            );
                            setToolProject(
                              node.type === "project" ? node.id : "",
                            );
                            setDetail(false);
                          }}
                        >
                          <Wrench size={15} />
                          {t(
                            node.tool ? "tools.openTool" : "tools.projectTools",
                          )}
                        </button>
                      )}
                      <div className="metadata">
                        <span className={`status ${node.status}`}>
                          {STATUS[node.status]}
                        </span>
                        <span>
                          {Number.isFinite(Date.parse(node.updated))
                            ? new Date(node.updated).toLocaleDateString(
                                locale(),
                              )
                            : t("m167")}
                        </span>
                      </div>
                      {node.tags.length > 0 && (
                        <div className="tags">
                          {node.tags.map((tag, i) => (
                            <button key={i} onClick={() => setQuery(tag)}>
                              #{tag}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="detail-section-title">
                        {t("m168")}
                        <button
                          onClick={() =>
                            setReader({
                              nodeId: node.id,
                            })
                          }
                        >
                          {t("m169")}
                          <ArrowUpRight size={13} />
                        </button>
                      </div>
                      <div className="note-preview">
                        <Md>{node.body}</Md>
                      </div>
                      {related.length > 0 && (
                        <>
                          <div className="detail-section-title">
                            {t("m172")}
                            <span>{related.length}</span>
                          </div>
                          {related.map((n) => (
                            <button
                              className="related-row"
                              key={n.id}
                              onClick={() => choose(n)}
                            >
                              <span
                                className="branch-dot"
                                style={{
                                  background: n.color,
                                }}
                              />
                              {n.title}
                              <ArrowUpRight size={14} />
                            </button>
                          ))}
                        </>
                      )}
                      {nodes.some((n) => n.parent === node.id) && (
                        <>
                          <div className="detail-section-title">
                            {t("m173")}
                          </div>
                          {nodes
                            .filter((n) => n.parent === node.id)
                            .map((n) => (
                              <button
                                className="related-row"
                                key={n.id}
                                onClick={() => choose(n)}
                              >
                                <Glyph type={n.type} />
                                {n.title}
                                <ChevronRight size={14} />
                              </button>
                            ))}
                        </>
                      )}
                      <button className="archive-button" onClick={archive}>
                        <Archive size={14} />
                        {t("m174")}
                      </button>
                    </div>
                    <div className="detail-footer">
                      <button
                        className="secondary-button"
                        onClick={() => newNode(node.id)}
                      >
                        <GitBranch size={16} />
                        {t("m175")}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="empty">
                    <Circle />
                    <h3>{t("m176")}</h3>
                    <p>{t("m177")}</p>
                    <button
                      className="secondary-button"
                      onClick={() => newNode(null)}
                    >
                      <Plus size={16} />
                      {t("m178")}
                    </button>
                  </div>
                )}
              </aside>
            )}
          </ResizableWorkspace>
        </section>
      </main>
      {view !== "backups" && !showSettings && <BackupTransferPanel floating />}
      <UploadRecovery
        onContinue={() => {
          setView("backups");
          setShowSettings(false);
        }}
      />
      <input
        ref={importRef}
        type="file"
        accept=".md,.markdown"
        hidden
        onChange={async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          try {
            const n = await api("import", {
              method: "POST",
              body: JSON.stringify({
                markdown: await file.text(),
              }),
            });
            await load();
            choose(n);
            notify(t("m180"));
          } catch (e) {
            notify(e.message);
          }
          e.target.value = "";
        }}
      />
      {editing?.type === "task" ? (
        <Suspense
          fallback={
            <div className="modal-backdrop">
              <p role="status">{t("m148")}</p>
            </div>
          }
        >
          <TaskDialog
            key={editing.id || "new-task"}
            initial={editing}
            nodes={nodes}
            settings={settings}
            env={env}
            orderRevision={orderRevision}
            onManage={() => setShowSettings(true)}
            onClose={() => setEditing(null)}
            onRefresh={load}
            onSave={async (value) => {
              const result = await api(
                editing.id ? `nodes/${editing.id}` : "nodes",
                {
                  method: editing.id ? "PUT" : "POST",
                  body: JSON.stringify(value),
                },
              );
              if (!editing.id) setEditing(result);
              await load();
              return result;
            }}
          />
        </Suspense>
      ) : (
        editing && (
          <Editor
            initial={editing}
            nodes={nodes}
            settings={settings}
            onManage={() => setShowSettings(true)}
            onClose={() => setEditing(null)}
            onSave={async (value) => {
              const n = await api(
                editing.id ? `nodes/${editing.id}` : "nodes",
                {
                  method: editing.id ? "PUT" : "POST",
                  body: JSON.stringify(value),
                },
              );
              await load();
              choose(n);
              setEditing(null);
              notify(t("m181"));
            }}
          />
        )
      )}
      {reader && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setReader(null);
          }}
        >
          <section
            className="reader modal"
            role="dialog"
            aria-modal="true"
            aria-label={readerContent.title}
          >
            <header>
              <div>
                <span className="eyebrow">{t("m182")}</span>
                <h2>{readerContent.title}</h2>
              </div>
              <button
                className="icon-button"
                autoFocus
                aria-label={t("m183")}
                onClick={() => setReader(null)}
              >
                <X />
              </button>
            </header>
            <div className="reader-body">
              <Md>{readerContent.body}</Md>
            </div>
            {reader.nodeId && (
              <footer>
                <a
                  className="secondary-button"
                  href={`./api/nodes/${reader.nodeId}/markdown`}
                >
                  <Download size={15} />
                  {t("m018")}
                </a>
              </footer>
            )}
          </section>
        </div>
      )}
      {showSettings &&
        settings.documentRoot &&
        (!snapshotReady ? (
          <div className="modal-backdrop">
            <section
              className="modal"
              role="dialog"
              aria-modal="true"
              aria-label={t("m029")}
            >
              <header>
                <h2>{t("m029")}</h2>
                <button
                  className="icon-button"
                  aria-label={t("m183")}
                  onClick={() => setShowSettings(false)}
                >
                  <X />
                </button>
              </header>
              <div className="empty" role="status">
                <LoaderCircle className="spin" />
                {error || t("m148")}
              </div>
            </section>
          </div>
        ) : (
          <LocationsSettings
            initial={settings}
            nodes={nodes}
            onClose={() => setShowSettings(false)}
            onSaved={(r) => {
              setSettings(r);
              setLanguage(r.language);
              load();
              notify(t("m184"));
            }}
          />
        ))}
      {openDocument && (
        <DocumentViewer
          key={`${openDocument.nodeId}:${openDocument.resourceId}`}
          resource={openDocument}
          onClose={() => setDocument(null)}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}
function Editor({ initial, nodes, settings, onManage, onClose, onSave }) {
  const [form, setForm] = useState({
      ...initial,
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState(false),
    [dirty, setDirty] = useState(false),
    [original, setOriginal] = useState(initial),
    [conflict, setConflict] = useState(null),
    [leaving, setLeaving] = useState(false);
  const draft = useDraft(
    `record:${initial.id || "new"}`,
    form,
    original,
    dirty,
  );
  const set = (key, value) => {
    setDirty(true);
    setForm((f) => ({
      ...f,
      [key]: value,
    }));
  };
  const excluded = descendants(nodes, initial.id);
  const close = () => {
    if (dirty) setLeaving(true);
    else onClose();
  };
  useDialogKeys(React, close);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  return (
    <div className="modal-backdrop">
      <form
        className="modal editor"
        role="dialog"
        aria-modal="true"
        aria-label={initial.id ? t("m160") : t("m120")}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const value = {
              ...form,
              ...(["project", "item", "task"].includes(form.type)
                ? withImportance(form, recordImportance(form))
                : {}),
              tags: form.tags.filter(Boolean),
              id: form.id || crypto.randomUUID(),
              schema: 2,
              resources: form.resources.map((r) => ({
                ...r,
                id: r.id || crypto.randomUUID(),
              })),
            };
            validateNode(value);
            await onSave(value);
            draft.clear();
          } catch (e) {
            setError(localizeMessage(e.message));
            if (e.status === 409 && initial.id) {
              try {
                setConflict(await api(`nodes/${initial.id}`));
              } catch {}
            }
          } finally {
            setBusy(false);
          }
        }}
      >
        <header>
          <div>
            <h2>{initial.id ? t("m160") : t("m120")}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label={t("m188")}
            onClick={close}
          >
            <X />
          </button>
        </header>
        <div className="editor-body">
          {leaving && (
            <DraftExit
              failed={draft.state === "failed"}
              onLeave={onClose}
              onStay={() => setLeaving(false)}
            />
          )}
          <DraftNotice
            draft={draft}
            onRecover={(saved) => {
              setForm(saved.value);
              setOriginal(saved.original);
              setDirty(true);
            }}
          />
          {conflict && (
            <ConflictReview
              base={original}
              mine={form}
              current={conflict}
              onCancel={() => setConflict(null)}
              onApply={(merged) => {
                setForm(merged);
                setOriginal(conflict);
                setConflict(null);
                setDirty(true);
                setError("");
              }}
            />
          )}
          <label>
            {t("m189")}
            <input
              autoFocus
              required
              maxLength={180}
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder={t("m190")}
            />
          </label>
          <div className="form-grid">
            <label>
              {t("m191")}
              <select
                value={form.type}
                onChange={(e) => set("type", e.target.value)}
              >
                {Object.entries(TYPES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("m192")}
              <select
                value={form.status}
                onChange={(e) => set("status", e.target.value)}
              >
                {Object.entries(
                  form.type === "task" ? TASK_STATUS : STATUS,
                ).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            {t("list.recordDate")}
            <input
              type="date"
              value={form.date || ""}
              onInput={(event) => set("date", event.currentTarget.value)}
            />
            <span className="field-help">{t("list.dateHelp")}</span>
          </label>
          <div className="importance-field">
            <span>{t("importance.label")}</span>
            <ImportanceStars
              value={recordImportance(form)}
              onChange={(importance) => set("importance", importance)}
            />
            <p className="field-help">
              {t(
                form.type === "task"
                  ? "importance.taskHelp"
                  : "importance.help",
              )}
            </p>
          </div>
          {form.type === "item" && (
            <InventoryEditor
              node={form}
              settings={settings}
              onManage={onManage}
              onChange={(next) => {
                setForm(next);
                setDirty(true);
              }}
            />
          )}
          {form.type === "task" && (
            <>
              <div className="form-grid">
                <label>
                  {t("m194")}
                  <input
                    type="date"
                    value={form.task?.start || ""}
                    onInput={(e) =>
                      set("task", {
                        ...form.task,
                        start: e.currentTarget.value,
                      })
                    }
                    onChange={(e) =>
                      set("task", {
                        ...form.task,
                        start: e.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  {t("m195")}
                  <input
                    type="date"
                    min={form.task?.start || undefined}
                    value={form.task?.due || ""}
                    onInput={(e) =>
                      set("task", {
                        ...form.task,
                        due: e.currentTarget.value,
                      })
                    }
                    onChange={(e) =>
                      set("task", {
                        ...form.task,
                        due: e.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  {t("m197")}
                  <input
                    maxLength={120}
                    placeholder={t("m198")}
                    value={form.task?.assignee || ""}
                    onChange={(e) =>
                      set("task", {
                        ...form.task,
                        assignee: e.target.value,
                      })
                    }
                  />
                </label>
              </div>
              <CheckpointEditor
                node={form}
                onChange={(checkpoints) =>
                  set("task", { ...form.task, checkpoints })
                }
              />
              <label>
                {t("m199")}
                <select
                  value={form.projectId || ""}
                  onChange={(e) => set("projectId", e.target.value)}
                >
                  <option value="">{t("m200")}</option>
                  {nodes
                    .filter((n) => n.type === "project")
                    .map((n) => (
                      <option value={n.id} key={n.id}>
                        {n.title}
                      </option>
                    ))}
                </select>
              </label>
            </>
          )}
          <label>
            {t("m201")}
            <select
              value={form.parent || ""}
              onChange={(e) => set("parent", e.target.value || null)}
            >
              <option value="">{t("m202")}</option>
              {nodes
                .filter((n) => !excluded.has(n.id))
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.title} · {TYPES[n.type]}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {t("m203")}
            <textarea
              rows={2}
              maxLength={2000}
              value={form.summary}
              onChange={(e) => set("summary", e.target.value)}
              placeholder={t("m204")}
            />
          </label>
          <div className="form-grid">
            <label>
              {t("m205")}
              <input
                value={form.tags.join(", ")}
                onChange={(e) =>
                  set(
                    "tags",
                    e.target.value.split(",").map((x) => x.trim()),
                  )
                }
                placeholder={t("m206")}
              />
            </label>
            <label>
              {t("m207")}
              <div className="colors">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={t("m401", c)}
                    className={form.color === c ? "chosen" : ""}
                    style={{
                      background: c,
                    }}
                    onClick={() => set("color", c)}
                  >
                    {form.color === c && <Check size={15} />}
                  </button>
                ))}
                <input
                  type="color"
                  aria-label={t("m208")}
                  value={form.color}
                  onChange={(e) => set("color", e.target.value)}
                />
              </div>
            </label>
          </div>
          <div className="editor-label">
            <span>{t("m209")}</span>
            <button type="button" onClick={() => setPreview(!preview)}>
              {preview ? t("m400") : t("m210")}
            </button>
          </div>
          {preview ? (
            <div className="edit-preview">
              <Md>{form.body}</Md>
            </div>
          ) : (
            <textarea
              className="code-input"
              rows={12}
              value={form.body}
              onChange={(e) => set("body", e.target.value)}
              aria-label={t("m211")}
              spellCheck={false}
            />
          )}
          <details className="editor-extra">
            <summary>
              <Link2 size={16} />
              {t("m212") + " "}
              <span>{form.related.length}</span>
            </summary>
            <div className="related-picker">
              {nodes
                .filter((n) => n.id !== form.id)
                .map((n) => (
                  <label key={n.id}>
                    <input
                      type="checkbox"
                      checked={form.related.includes(n.id)}
                      onChange={(e) =>
                        set(
                          "related",
                          e.target.checked
                            ? [...form.related, n.id]
                            : form.related.filter((id) => id !== n.id),
                        )
                      }
                    />
                    {n.title}
                  </label>
                ))}
            </div>
          </details>
          <ResourceEditor
            resources={form.resources}
            onChange={(resources) => {
              setDirty(true);
              setForm((f) => ({
                ...f,
                resources,
                previewResourceId: resources.some(
                  (r) => r.id === f.previewResourceId,
                )
                  ? f.previewResourceId
                  : "",
              }));
            }}
            settings={settings}
            onManage={onManage}
          />
          <label className="preview-choice">
            {t("documents.doubleClick")}
            <select
              value={form.previewResourceId || ""}
              onChange={(e) => set("previewResourceId", e.target.value)}
            >
              <option value="">{t("documents.recordMarkdown")}</option>
              {form.resources
                .filter(
                  (r) =>
                    r.id &&
                    settings.locations?.find(
                      (l) =>
                        l.id === (r.locationId || (r.url ? "internet" : "pc")),
                    )?.kind !== "physical",
                )
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label || r.path || r.url}
                  </option>
                ))}
            </select>
            <small>{t("documents.doubleClickHelp")}</small>
          </label>
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
        </div>
        <footer>
          <span>
            <FileText size={14} />
            {t("m213")}
          </span>
          <button type="button" className="secondary-button" onClick={close}>
            {t("m047")}
          </button>
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Check size={16} />
            )}
            {t("m214")}
          </button>
        </footer>
      </form>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
