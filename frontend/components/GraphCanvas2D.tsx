"use client";

/* eslint-disable @typescript-eslint/no-explicit-any -- force-graph mutates node and link objects at runtime beyond the static app model. */

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { useWindowSize } from "../hooks/useWindowSize";
import api from "../lib/api";
import type { GraphData } from "../lib/types";
import { useToast } from "./Toast";

import { ZoomIn, ZoomOut, Maximize2, RefreshCcw, Sparkles } from "lucide-react";

const ROLES = [
  { key: "father", label: "Father", color: "#60a5fa", defaultGender: "male" },
  { key: "mother", label: "Mother", color: "#f472b6", defaultGender: "female" },
  { key: "spouse", label: "Spouse", color: "#a78bfa", defaultGender: "male" },
  { key: "child", label: "Child", color: "#34d399", defaultGender: "male" },
  { key: "sibling", label: "Sibling", color: "#fb923c", defaultGender: "male" },
] as const;

type RoleKey = (typeof ROLES)[number]["key"];

interface FloatingMenu {
  node: any;
  sx: number;
  sy: number;
}

interface AddForm {
  role: RoleKey;
  name: string;
  gender: string;
}

interface Position {
  x: number;
  y: number;
  z: number;
}

type PositionMap = Record<string, Position>;

const getNodeId = (v: any): string => (typeof v === "object" ? String(v.id) : String(v));
const parentRelTypeForGender = (gender?: string) => (gender === "female" ? "mother" : "father");
const pairKey = (a: string, b: string) => [a, b].sort().join("|");
const linkId = (link: any): string => `${getNodeId(link.source)}|${getNodeId(link.target)}|${link.type ?? "unknown"}`;

const FALLBACK_GOLDEN = Math.PI * (3 - Math.sqrt(5));
const VISUAL_DISTANCE_SCALE = 0.8;
const NODE_RADIUS = 7.4;
const NODE_HIT_RADIUS = 20;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseMetadata(raw: any): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function getDbCoordinates(node: any): Position | null {
  const metadata = parseMetadata(node?.metadata);
  const x = toNumber(metadata.x);
  const y = toNumber(metadata.y);
  const z = toNumber(metadata.z) ?? 0;
  if (x === null || y === null) return null;
  return { x, y, z };
}

function buildFallbackPosition(index: number): Position {
  const angle = index * FALLBACK_GOLDEN;
  const radius = 75 + Math.sqrt(index + 1) * 26;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
    z: 0,
  };
}

export default function GraphCanvas2D({
  data,
  onNodeClick,
  selectedNodeId,
  focusNodeId,
  onFocusHandled,
  onRefresh,
}: {
  data: GraphData;
  onNodeClick: (node: any) => void;
  selectedNodeId: string | null;
  focusNodeId: string | null;
  onFocusHandled: () => void;
  onRefresh: () => Promise<void>;
}) {
  const fgRef = useRef<any>(null);
  const size = useWindowSize();
  const { toast } = useToast();

  const [hoverNode, setHoverNode] = useState<any>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [floatingMenu, setFloatingMenu] = useState<FloatingMenu | null>(null);
  const [addForm, setAddForm] = useState<AddForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [legendOpen, setLegendOpen] = useState(true);
  const [optimizing, setOptimizing] = useState(false);
  const [resetTick, setResetTick] = useState(0);

  // Session-only node overrides. Refresh resets to DB coordinates.
  const [localPositions, setLocalPositions] = useState<PositionMap>({});

  const [highlightNodes, setHighlightNodes] = useState(new Set<string>());
  const [highlightLinks, setHighlightLinks] = useState(new Set<string>());

  const displayGraph = useMemo(() => {
    const personNodes = (data?.nodes ?? []).map((n: any) => ({ ...n, __virtual: false }));

    const spousePairs = new Map<string, { a: string; b: string; unionId: string }>();
    const parentEdgesByChild = new Map<string, Array<{ parentId: string; type: string }>>();

    for (const l of data?.links ?? []) {
      const src = getNodeId(l.source);
      const tgt = getNodeId(l.target);
      if (l.type === "spouse") {
        const key = pairKey(src, tgt);
        if (!spousePairs.has(key)) {
          const [a, b] = [src, tgt].sort();
          spousePairs.set(key, { a, b, unionId: `union:${key}` });
        }
      }
      if (l.type === "father" || l.type === "mother") {
        const arr = parentEdgesByChild.get(tgt) ?? [];
        arr.push({ parentId: src, type: l.type });
        parentEdgesByChild.set(tgt, arr);
      }
    }

    const unions = Array.from(spousePairs.values());
    const unionNodes = unions.map((u) => ({ id: u.unionId, name: "", __virtual: true, __pair: [u.a, u.b] }));

    const displayLinks: any[] = [];
    const consumedParentLinks = new Set<string>();
    const childUnionMap = new Map<string, string>();

    for (const u of unions) {
      displayLinks.push({ source: u.a, target: u.unionId, type: "spouse_arm", __id: `${u.a}|${u.unionId}|spouse_arm` });
      displayLinks.push({ source: u.b, target: u.unionId, type: "spouse_arm", __id: `${u.b}|${u.unionId}|spouse_arm` });
    }

    for (const [childId, parents] of parentEdgesByChild.entries()) {
      if (parents.length < 2) continue;
      const uniqueParents = Array.from(new Set(parents.map((p) => p.parentId)));
      if (uniqueParents.length < 2) continue;

      const key = pairKey(uniqueParents[0], uniqueParents[1]);
      const union = spousePairs.get(key);
      if (!union) continue;

      displayLinks.push({ source: union.unionId, target: childId, type: "parent_mid", __id: `${union.unionId}|${childId}|parent_mid` });
      childUnionMap.set(childId, union.unionId);

      for (const p of parents) {
        consumedParentLinks.add(`${p.parentId}|${childId}|${p.type}`);
      }
    }

    for (const l of data?.links ?? []) {
      const src = getNodeId(l.source);
      const tgt = getNodeId(l.target);
      const id = `${src}|${tgt}|${l.type}`;

      if (l.type === "spouse") continue;
      if ((l.type === "father" || l.type === "mother") && consumedParentLinks.has(id)) continue;

      if (l.type === "sibling") {
        const su = childUnionMap.get(src);
        const tu = childUnionMap.get(tgt);
        if (su && tu && su === tu) continue;
      }

      displayLinks.push({ ...l, source: src, target: tgt, __id: id });
    }

    const fallbackOrder = [...personNodes].sort((a, b) => {
      const ak = `${String(a.name ?? "").toLowerCase()}|${String(a.id)}`;
      const bk = `${String(b.name ?? "").toLowerCase()}|${String(b.id)}`;
      return ak.localeCompare(bk);
    });
    const fallbackById = new Map<string, Position>();
    fallbackOrder.forEach((node, idx) => {
      fallbackById.set(String(node.id), buildFallbackPosition(idx));
    });

    for (const node of personNodes) {
      const id = String(node.id);
      const fromLocal = localPositions[id];
      const fromDb = getDbCoordinates(node);
      const fallback = fallbackById.get(id) ?? { x: 0, y: 0, z: 0 };
      const next = fromLocal ?? fromDb ?? fallback;

      const scaledX = next.x * VISUAL_DISTANCE_SCALE;
      const scaledY = next.y * VISUAL_DISTANCE_SCALE;
      const scaledZ = next.z * VISUAL_DISTANCE_SCALE;

      node.x = scaledX;
      node.y = scaledY;
      node.z = scaledZ;
      node.fx = scaledX;
      node.fy = scaledY;
      node.fz = scaledZ;
    }

    const allNodes = [...personNodes, ...unionNodes];
    const allById = new Map<string, any>();
    allNodes.forEach((n) => allById.set(String(n.id), n));

    for (const u of unions) {
      const a = allById.get(u.a);
      const b = allById.get(u.b);
      const m = allById.get(u.unionId);
      if (!a || !b || !m) continue;

      const ax = Number.isFinite(a.x) ? Number(a.x) : 0;
      const ay = Number.isFinite(a.y) ? Number(a.y) : 0;
      const az = Number.isFinite(a.z) ? Number(a.z) : 0;
      const bx = Number.isFinite(b.x) ? Number(b.x) : 0;
      const by = Number.isFinite(b.y) ? Number(b.y) : 0;
      const bz = Number.isFinite(b.z) ? Number(b.z) : 0;

      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      const mz = (az + bz) / 2;

      m.x = mx;
      m.y = my;
      m.z = mz;
      m.fx = mx;
      m.fy = my;
      m.fz = mz;
    }

    return {
      nodes: allNodes,
      links: displayLinks,
      unions,
      childUnionMap,
    };
  }, [data, localPositions]);

  useEffect(() => {
    const activeNodeId = floatingMenu?.node?.id || selectedNodeId || hoverNode?.id;
    if (!activeNodeId) {
      setHighlightNodes(new Set());
      setHighlightLinks(new Set());
      return;
    }

    const startId = String(activeNodeId);
    const adj = new Map<string, string[]>();

    for (const l of displayGraph.links) {
      const s = getNodeId(l.source);
      const t = getNodeId(l.target);
      if (!adj.has(s)) adj.set(s, []);
      if (!adj.has(t)) adj.set(t, []);
      adj.get(s)?.push(t);
      adj.get(t)?.push(s);
    }

    const visited = new Set<string>([startId]);
    const q: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];
    const maxDepth = 2;

    while (q.length) {
      const cur = q.shift()!;
      if (cur.depth >= maxDepth) continue;
      for (const nxt of adj.get(cur.id) ?? []) {
        if (!visited.has(nxt)) {
          visited.add(nxt);
          q.push({ id: nxt, depth: cur.depth + 1 });
        }
      }
    }

    const highlightedLinks = new Set<string>();
    for (const l of displayGraph.links) {
      const s = getNodeId(l.source);
      const t = getNodeId(l.target);
      if (visited.has(s) && visited.has(t)) highlightedLinks.add(l.__id ?? linkId(l));
    }

    setHighlightNodes(visited);
    setHighlightLinks(highlightedLinks);
  }, [displayGraph.links, floatingMenu?.node?.id, hoverNode?.id, selectedNodeId]);

  // Keep union nodes exactly at spouse midpoints so family bars stay clean and stable.
  useEffect(() => {
    if (!displayGraph.unions.length) return;
    let raf = 0;
    const tick = () => {
      const nodesById = new Map<string, any>();
      for (const n of displayGraph.nodes) nodesById.set(String(n.id), n);

      for (const u of displayGraph.unions) {
        const a = nodesById.get(u.a);
        const b = nodesById.get(u.b);
        const m = nodesById.get(u.unionId);
        if (!a || !b || !m) continue;
        if (a.x === undefined || a.y === undefined || b.x === undefined || b.y === undefined) continue;

        const x = (a.x + b.x) / 2;
        const y = (a.y + b.y) / 2;
        const z = ((Number(a.z) || 0) + (Number(b.z) || 0)) / 2;

        m.x = x;
        m.y = y;
        m.z = z;
        m.fx = x;
        m.fy = y;
        m.fz = z;
      }

      raf = window.requestAnimationFrame(tick);
    };

    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [displayGraph.nodes, displayGraph.unions, resetTick]);

  useEffect(() => {
    if (!hoverNode || !fgRef.current) {
      setHoverPos(null);
      return;
    }

    let raf: number;
    const tick = () => {
      if (hoverNode?.x !== undefined && hoverNode?.y !== undefined && fgRef.current) {
        const c = fgRef.current.graph2ScreenCoords(hoverNode.x, hoverNode.y);
        setHoverPos({ x: c.x, y: c.y });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hoverNode]);

  const floatingNodeId = floatingMenu ? String(floatingMenu.node.id) : null;

  useEffect(() => {
    if (!floatingNodeId) return;

    let raf: number;
    const tick = () => {
      if (!fgRef.current) return;
      const node = displayGraph.nodes.find((n: any) => String(n.id) === floatingNodeId);
      if (node?.x !== undefined && node?.y !== undefined) {
        const c = fgRef.current.graph2ScreenCoords(node.x, node.y);
        setFloatingMenu((prev) => (prev ? { ...prev, sx: c.x, sy: c.y } : null));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [displayGraph.nodes, floatingNodeId]);

  useEffect(() => {
    if (!focusNodeId || !fgRef.current) return;
    const t = setTimeout(() => {
      const node = displayGraph.nodes.find((n: any) => !n.__virtual && String(n.id) === String(focusNodeId));
      if (node?.x !== undefined && node?.y !== undefined) {
        fgRef.current?.centerAt(node.x, node.y, 950);
        fgRef.current?.zoom(2.6, 950);
      }
      onFocusHandled();
    }, 120);

    return () => clearTimeout(t);
  }, [displayGraph.nodes, focusNodeId, onFocusHandled]);

  useEffect(() => {
    if (!fgRef.current || displayGraph.nodes.length === 0) return;
    const t = setTimeout(() => fgRef.current?.zoomToFit(700, 120), 380);
    return () => clearTimeout(t);
  }, [displayGraph.nodes.length, resetTick]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFloatingMenu(null);
        setAddForm(null);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const nodePointerAreaPaint = useCallback((node: any, color: string, ctx: CanvasRenderingContext2D) => {
    if (node.__virtual) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(node.x, node.y, NODE_HIT_RADIUS, 0, 2 * Math.PI);
    ctx.fill();
  }, []);

  const paintNode2D = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    if (node.__virtual) return;

    const isHovered = node === hoverNode;
    const isSelected = floatingMenu?.node?.id === node.id || selectedNodeId === node.id;
    const hasHighlights = highlightNodes.size > 0;
    const isGhosted = hasHighlights && !highlightNodes.has(String(node.id));

    const radius = NODE_RADIUS;
    let fill = "#94a3b8";
    if (node.gender === "male") fill = "#60a5fa";
    if (node.gender === "female") fill = "#f472b6";

    ctx.globalAlpha = isGhosted ? 0.16 : 1;

    if (isSelected || isHovered) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius + 2.2, 0, 2 * Math.PI);
      ctx.fillStyle = isSelected ? "rgba(255,255,255,0.24)" : "rgba(148,163,184,0.22)";
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.lineWidth = isSelected ? 1.15 : 0.7;
    ctx.strokeStyle = isSelected ? "rgba(255,255,255,0.96)" : "rgba(226,232,240,0.65)";
    ctx.stroke();

    const label = String(node.name ?? "");
    const fontSize = Math.max(8, 12 / globalScale);
    ctx.font = `600 ${fontSize}px Sora, "Nunito Sans", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = isGhosted ? "rgba(203, 213, 225, 0.35)" : "rgba(241, 245, 249, 0.95)";
    ctx.fillText(label, node.x, node.y + radius + fontSize * 0.95);

    ctx.globalAlpha = 1;
  }, [floatingMenu, highlightNodes, hoverNode, selectedNodeId]);

  const linkColor = useCallback((link: any): string => {
    const id = link.__id ?? linkId(link);
    const isGhosted = highlightNodes.size > 0 && !highlightLinks.has(id);
    if (isGhosted) return "rgba(100, 116, 139, 0.08)";

    if (link.type === "spouse_arm") return "rgba(216, 180, 254, 0.55)";
    if (link.type === "parent_mid") return "rgba(226, 232, 240, 0.40)";
    if (link.type === "father") return "rgba(186, 230, 253, 0.42)";
    if (link.type === "mother") return "rgba(251, 207, 232, 0.42)";
    if (link.type === "sibling") return "rgba(252, 211, 77, 0.34)";
    return "rgba(148, 163, 184, 0.3)";
  }, [highlightLinks, highlightNodes.size]);

  const linkWidth = useCallback((link: any): number => {
    const id = link.__id ?? linkId(link);
    const isGhosted = highlightNodes.size > 0 && !highlightLinks.has(id);
    if (isGhosted) return 0.28;
    if (link.type === "spouse_arm") return 1;
    return 0.68;
  }, [highlightLinks, highlightNodes.size]);

  const handleNodeClick = useCallback((node: any) => {
    if (node?.__virtual) return;
    onNodeClick(node);
    if (!fgRef.current) return;
    const c = fgRef.current.graph2ScreenCoords(node.x, node.y);
    setFloatingMenu({ node, sx: c.x, sy: c.y });
    setAddForm(null);
  }, [onNodeClick]);

  const handleBgClick = useCallback(() => {
    setFloatingMenu(null);
    setAddForm(null);
  }, []);

  const handlePlusClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!hoverNode || hoverNode.__virtual || !fgRef.current) return;
    const c = fgRef.current.graph2ScreenCoords(hoverNode.x, hoverNode.y);
    setFloatingMenu({ node: hoverNode, sx: c.x, sy: c.y });
    setAddForm(null);
    onNodeClick(hoverNode);
  }, [hoverNode, onNodeClick]);

  const findSpouseId = useCallback((personId: string): string | null => {
    for (const l of data?.links ?? []) {
      if (l.type !== "spouse") continue;
      const s = getNodeId(l.source);
      const t = getNodeId(l.target);
      if (s === personId) return t;
      if (t === personId) return s;
    }
    return null;
  }, [data?.links]);

  const incomingParentLinks = useCallback((childId: string) => {
    return (data?.links ?? []).filter((l: any) => {
      if (!(l.type === "father" || l.type === "mother")) return false;
      return getNodeId(l.target) === childId;
    });
  }, [data?.links]);

  const defaultGenderForRole = useCallback((role: RoleKey, node: any) => {
    if (role === "spouse") {
      if (node?.gender === "male") return "female";
      if (node?.gender === "female") return "male";
      return "male";
    }
    return ROLES.find((r) => r.key === role)?.defaultGender ?? "male";
  }, []);

  const suggestNewNodeCoordinates = useCallback((role: RoleKey, anchorNode: any) => {
    const baseX = Number(anchorNode?.x) || 0;
    const baseY = Number(anchorNode?.y) || 0;
    const baseZ = Number(anchorNode?.z) || 0;
    const seed = (data?.nodes?.length ?? 0) + (data?.links?.length ?? 0);
    const spin = (seed % 12) * (Math.PI / 6);
    const spread = 24 + (seed % 5) * 7;

    const offsets: Record<RoleKey, Position> = {
      spouse: { x: 165, y: 0, z: 0 },
      father: { x: -80, y: -185, z: 35 },
      mother: { x: 80, y: -185, z: -35 },
      child: { x: 0, y: 185, z: 0 },
      sibling: { x: 150, y: 45, z: 40 },
    };

    const off = offsets[role];
    return {
      x: round2(baseX + off.x + Math.cos(spin) * spread),
      y: round2(baseY + off.y + Math.sin(spin) * spread * 0.5),
      z: round2(baseZ + off.z + Math.sin(spin) * spread),
    };
  }, [data?.links?.length, data?.nodes?.length]);

  const optimizeLayout = useCallback(async (withToast: boolean) => {
    setOptimizing(true);
    try {
      await api.post("/api/graph/layout/optimize");
      if (withToast) toast("Graph layout optimized");
    } catch {
      toast("Failed to optimize graph layout", "error");
    } finally {
      setLocalPositions({});
      await onRefresh();
      setOptimizing(false);
    }
  }, [onRefresh, toast]);

  const handleSave = async () => {
    if (!addForm || !floatingMenu || !addForm.name.trim()) return;
    setSaving(true);
    try {
      const srcId = String(floatingMenu.node.id);
      const metadata = suggestNewNodeCoordinates(addForm.role, floatingMenu.node);

      const { data: np } = await api.post("/api/persons", {
        name: addForm.name.trim(),
        gender: addForm.gender,
        metadata,
      });
      const newId = String(np.id);

      if (addForm.role === "spouse") {
        await api.post("/api/relationships", { from_person_id: srcId, to_person_id: newId, type: "spouse" });
      }

      if (addForm.role === "father" || addForm.role === "mother") {
        await api.post("/api/relationships", { from_person_id: newId, to_person_id: srcId, type: addForm.role });
      }

      if (addForm.role === "child") {
        const srcType = parentRelTypeForGender(floatingMenu.node.gender);
        await api.post("/api/relationships", { from_person_id: srcId, to_person_id: newId, type: srcType });

        const spouseId = findSpouseId(srcId);
        if (spouseId) {
          const spouseNode = data.nodes.find((n: any) => String(n.id) === spouseId);
          const spouseType = parentRelTypeForGender(spouseNode?.gender);
          await api.post("/api/relationships", { from_person_id: spouseId, to_person_id: newId, type: spouseType });
        }
      }

      if (addForm.role === "sibling") {
        const parents = incomingParentLinks(srcId);
        if (parents.length > 0) {
          const seen = new Set<string>();
          for (const p of parents) {
            const pId = getNodeId(p.source);
            if (seen.has(`${pId}|${p.type}`)) continue;
            seen.add(`${pId}|${p.type}`);
            await api.post("/api/relationships", {
              from_person_id: pId,
              to_person_id: newId,
              type: p.type,
            });
          }
        } else {
          await api.post("/api/relationships", { from_person_id: srcId, to_person_id: newId, type: "sibling" });
        }
      }

      // New person gets a quick local estimate first, then DB layout is optimized globally.
      await optimizeLayout(false);

      toast(`${addForm.name} added as ${addForm.role}`);
      setFloatingMenu(null);
      setAddForm(null);
    } catch (err: any) {
      toast(err.response?.data?.error ?? "Failed to save", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleNodeHover = useCallback((node: any) => {
    if (node?.__virtual) {
      setHoverNode(null);
      setHoverPos(null);
      return;
    }
    setHoverNode(node ?? null);
    if (!node) setHoverPos(null);
  }, []);

  const handleNodeDragEnd = useCallback((node: any) => {
    if (!node || node.__virtual) return;
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return;

    const next = {
      x: Number(node.x),
      y: Number(node.y),
      z: Number.isFinite(node.z) ? Number(node.z) : 0,
    };

    node.fx = next.x;
    node.fy = next.y;
    node.fz = next.z;

    setLocalPositions((prev) => ({ ...prev, [String(node.id)]: next }));
  }, []);

  const resetView = useCallback(() => {
    setLocalPositions({});
    if (fgRef.current) {
      fgRef.current.centerAt(0, 0, 850);
      fgRef.current.zoom(1.08, 850);
    }
    setResetTick((t) => t + 1);
  }, []);

  const panelWidth = selectedNodeId ? 320 : 0;
  const graphWidth = Math.max(400, (size.width ?? 1024) - panelWidth);
  const graphHeight = Math.max(300, (size.height ?? 768) - 56);

  const zoomBy = (factor: number) => {
    if (!fgRef.current) return;
    fgRef.current.zoom(fgRef.current.zoom() * factor, 260);
  };

  return (
    <div
      className="relative w-full h-full cursor-move"
      style={{
        background: "radial-gradient(circle at 18% 16%, #1a2235 0%, #0a1120 48%, #020617 100%)",
      }}
    >
      <ForceGraph2D
        ref={fgRef}
        graphData={displayGraph}
        nodeId="id"
        nodeLabel=""
        nodeCanvasObject={paintNode2D}
        nodePointerAreaPaint={nodePointerAreaPaint}
        nodeVal={(node: any) => (node.__virtual ? 0.15 : 1)}
        linkColor={linkColor}
        linkWidth={linkWidth}
        linkDirectionalParticles={0}
        linkDirectionalArrowLength={0}
        linkCurvature={0}
        backgroundColor="rgba(0,0,0,0)"
        width={graphWidth}
        height={graphHeight}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        onNodeDragEnd={handleNodeDragEnd}
        onBackgroundClick={handleBgClick}
        d3AlphaDecay={1}
        d3VelocityDecay={1}
        cooldownTicks={0}
      />

      {hoverPos && hoverNode && !floatingMenu && (
        <button
          style={{ left: hoverPos.x + 16, top: hoverPos.y - 20, transform: "translateY(-50%)" }}
          className="absolute z-20 w-7 h-7 rounded-full bg-blue-600/90 hover:bg-blue-500 text-white flex items-center justify-center shadow-[0_0_15px_rgba(59,130,246,0.45)] border border-blue-300/60 text-sm font-bold transition-all hover:scale-110 backdrop-blur-sm"
          onMouseDown={handlePlusClick}
          title="Add relative"
        >
          +
        </button>
      )}

      {floatingMenu && !addForm && (
        <div
          className="absolute z-30 pointer-events-auto animate-in fade-in zoom-in duration-200"
          style={{ left: floatingMenu.sx + 28, top: floatingMenu.sy - 90 }}
        >
          <div
            className="bg-slate-950/65 border border-white/10 rounded-2xl shadow-[0_0_40px_rgba(0,0,0,0.5)] p-3 backdrop-blur-xl"
            style={{ minWidth: 190 }}
          >
            <p
              className="text-[13px] font-bold text-white px-1 pb-2 mb-2 border-b border-white/10 truncate tracking-wide"
              style={{ maxWidth: 170 }}
            >
              {floatingMenu.node.name}
            </p>
            <div className="flex flex-col gap-1">
              {ROLES.map((r) => (
                <button
                  key={r.key}
                  onClick={() =>
                    setAddForm({
                      role: r.key,
                      name: "",
                      gender: defaultGenderForRole(r.key, floatingMenu.node),
                    })
                  }
                  className="flex items-center gap-2 w-full px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-white/10 transition-colors text-left"
                  style={{ color: r.color }}
                >
                  <span className="text-sm font-bold leading-none opacity-80">+</span> {r.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                setFloatingMenu(null);
                setAddForm(null);
              }}
              className="w-full mt-2 pt-2 border-t border-white/10 text-[11px] text-slate-400 hover:text-white transition-colors uppercase tracking-wider font-semibold"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {floatingMenu && addForm && (
        <div
          className="absolute z-30 pointer-events-auto animate-in fade-in slide-in-from-left-4 duration-200"
          style={{ left: floatingMenu.sx + 28, top: floatingMenu.sy - 90, width: 246 }}
        >
          <div className="bg-slate-950/65 border border-white/10 rounded-2xl shadow-[0_0_40px_rgba(0,0,0,0.5)] p-5 backdrop-blur-xl">
            <p
              className="text-xs font-bold mb-4 tracking-wider uppercase"
              style={{ color: ROLES.find((r) => r.key === addForm.role)?.color }}
            >
              Add {addForm.role}
            </p>
            <input
              autoFocus
              placeholder="Full name"
              value={addForm.name}
              onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              className="w-full mb-3 bg-black/40 border border-white/10 focus:border-blue-500 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition-colors shadow-inner"
            />
            <select
              value={addForm.gender}
              onChange={(e) => setAddForm({ ...addForm, gender: e.target.value })}
              className="w-full mb-4 bg-black/40 border border-white/10 focus:border-blue-500 rounded-lg px-3 py-2.5 text-sm text-white outline-none transition-colors shadow-inner [&>option]:bg-slate-900"
            >
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
            <div className="flex gap-2">
              <button
                onClick={() => setAddForm(null)}
                className="flex-1 py-2 text-xs font-semibold uppercase tracking-wider rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !addForm.name.trim()}
                className="flex-1 py-2 text-xs font-semibold uppercase tracking-wider rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-40 shadow-[0_0_15px_rgba(59,130,246,0.3)]"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="absolute right-6 bottom-6 z-10 flex flex-col gap-2">
        <button
          onClick={() => zoomBy(0.72)}
          className="w-10 h-10 bg-slate-900/65 hover:bg-slate-800/85 border border-white/10 backdrop-blur-xl rounded-2xl text-white flex items-center justify-center shadow-lg transition-all hover:scale-105"
          title="Zoom in"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={() => zoomBy(1.4)}
          className="w-10 h-10 bg-slate-900/65 hover:bg-slate-800/85 border border-white/10 backdrop-blur-xl rounded-2xl text-white flex items-center justify-center shadow-lg transition-all hover:scale-105"
          title="Zoom out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={() => fgRef.current?.zoomToFit(600, 100)}
          className="w-10 h-10 bg-slate-900/65 hover:bg-slate-800/85 border border-white/10 backdrop-blur-xl rounded-2xl text-white flex items-center justify-center shadow-lg transition-all hover:scale-105"
          title="Fit to view"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
        <button
          onClick={resetView}
          className="w-10 h-10 bg-cyan-900/45 hover:bg-cyan-800/70 border border-cyan-300/30 backdrop-blur-xl rounded-2xl text-cyan-200 flex items-center justify-center shadow-lg transition-all hover:scale-105"
          title="Reset to DB coordinates"
        >
          <RefreshCcw className="w-4 h-4" />
        </button>
        <button
          onClick={() => optimizeLayout(true)}
          disabled={optimizing}
          className="w-10 h-10 bg-emerald-900/45 hover:bg-emerald-800/70 border border-emerald-300/30 backdrop-blur-xl rounded-2xl text-emerald-200 flex items-center justify-center shadow-lg transition-all hover:scale-105 disabled:opacity-50"
          title="Re-optimize layout in DB"
        >
          <Sparkles className="w-4 h-4" />
        </button>
      </div>

      <div className="absolute bottom-6 left-6 z-10">
        <button
          onClick={() => setLegendOpen((o) => !o)}
          className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 hover:text-white transition-colors mb-2 ml-1"
        >
          {legendOpen ? "v Legend" : "> Legend"}
        </button>
        {legendOpen && (
          <div className="bg-slate-950/65 border border-white/10 rounded-2xl p-4 backdrop-blur-xl shadow-2xl pointer-events-none select-none animate-in fade-in slide-in-from-bottom-2">
            <div className="flex flex-col gap-2.5 text-[13px] font-medium">
              <div className="flex items-center gap-3">
                <span className="w-3 h-3 rounded-full bg-blue-400/20 border border-blue-300 shadow-[0_0_8px_rgba(96,165,250,0.45)] flex-shrink-0" />
                <span className="text-slate-200">Male</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="w-3 h-3 rounded-full bg-pink-400/20 border border-pink-300 shadow-[0_0_8px_rgba(244,114,182,0.45)] flex-shrink-0" />
                <span className="text-slate-200">Female</span>
              </div>
              <div className="border-t border-white/10 mt-1 pt-2.5 flex flex-col gap-2">
                {[
                  { color: "#bae6fd", label: "Parent line" },
                  { color: "#d8b4fe", label: "Spouse line" },
                  { color: "#fcd34d", label: "Sibling line" },
                ].map(({ color, label }) => (
                  <div key={label} className="flex items-center gap-3">
                    <span className="h-[2px] w-6 rounded-full flex-shrink-0 shadow-sm" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
                    <span className="text-slate-300">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {displayGraph.nodes.filter((n: any) => !n.__virtual).length > 0 && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
          <span className="text-xs font-medium tracking-wide text-slate-300 bg-slate-950/60 px-5 py-2.5 rounded-2xl border border-white/10 shadow-xl backdrop-blur-xl select-none">
            Select to focus | Hover to add | Drag nodes for local view | Refresh restores DB layout
          </span>
        </div>
      )}

      {displayGraph.nodes.filter((n: any) => !n.__virtual).length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
          <div className="text-center flex flex-col items-center gap-4 opacity-70">
            <div className="w-20 h-20 rounded-3xl bg-slate-900/60 border border-white/10 backdrop-blur-xl shadow-2xl flex items-center justify-center">
              <svg className="w-10 h-10 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </div>
            <div>
              <p className="text-slate-300 text-lg font-bold tracking-tight">No family members yet</p>
              <p className="text-slate-500 text-sm mt-1.5 font-medium">Click &quot;+ Person&quot; in the toolbar to get started</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
