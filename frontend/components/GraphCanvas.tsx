"use client";

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import ForceGraph3D from "react-force-graph-3d";
import { useWindowSize } from "../hooks/useWindowSize";
import api from "../lib/api";
import { useToast } from "./Toast";
import * as d3Force from "d3-force";
import * as THREE from "three";
import { ZoomIn, ZoomOut, Maximize2, RefreshCcw, Sparkles, Trash2 } from "lucide-react";

/* ────────────────────────── constants ────────────────────────── */

const ROLES = [
  { key: "father",  label: "Father",  color: "#60a5fa", defaultGender: "male"   },
  { key: "mother",  label: "Mother",  color: "#f472b6", defaultGender: "female" },
  { key: "spouse",  label: "Spouse",  color: "#a78bfa", defaultGender: "male"   },
  { key: "child",   label: "Child",   color: "#34d399", defaultGender: "male"   },
  { key: "sibling", label: "Sibling", color: "#fb923c", defaultGender: "male"   },
] as const;

type RoleKey = (typeof ROLES)[number]["key"];

interface FloatingMenu { node: any; sx: number; sy: number }
interface AddForm { role: RoleKey; name: string; gender: string }
interface LinkPopup { link: any; sx: number; sy: number }

const getNodeId = (v: any): string =>
  typeof v === "object" ? String(v.id) : String(v);
const parentRelTypeForGender = (g?: string) =>
  g === "female" ? "mother" : "father";
const pairKey = (a: string, b: string) => [a, b].sort().join("|");
const linkId = (l: any): string =>
  `${getNodeId(l.source)}|${getNodeId(l.target)}|${l.type ?? "unknown"}`;

const NODE_R   = 5;
const GLOW_R   = 9;
const BG_COLOR = "#020817";

/* ────────────────────────── component ────────────────────────── */

export default function GraphCanvas({
  data,
  onNodeClick,
  selectedNodeId,
  focusNodeId,
  onFocusHandled,
  onRefresh,
}: {
  data: any;
  onNodeClick: (node: any) => void;
  selectedNodeId: string | null;
  focusNodeId: string | null;
  onFocusHandled: () => void;
  onRefresh: () => void;
}) {
  const fgRef = useRef<any>(null);
  const size  = useWindowSize();
  const { toast } = useToast();

  const [hoverNode,    setHoverNode   ] = useState<any>(null);
  const [hoverPos,     setHoverPos    ] = useState<{ x: number; y: number } | null>(null);
  const [floatingMenu, setFloatingMenu] = useState<FloatingMenu | null>(null);
  const [addForm,      setAddForm     ] = useState<AddForm | null>(null);
  const [saving,       setSaving      ] = useState(false);
  const [legendOpen,   setLegendOpen  ] = useState(true);
  const [optimizing,   setOptimizing  ] = useState(false);
  const [resetTick,    setResetTick   ] = useState(0);
  const [linkPopup,    setLinkPopup   ] = useState<LinkPopup | null>(null);
  const [deletingLink, setDeletingLink] = useState(false);

  const [highlightNodes, setHighlightNodes] = useState(new Set<string>());
  const [highlightLinks, setHighlightLinks] = useState(new Set<string>());

  /* shared THREE geometries — created once, disposed on unmount */
  const sphereGeom = useMemo(() => new THREE.SphereGeometry(NODE_R, 32, 32), []);
  const glowGeom   = useMemo(() => new THREE.SphereGeometry(GLOW_R, 32, 32), []);

  useEffect(() => {
    return () => { sphereGeom.dispose(); glowGeom.dispose(); };
  }, [sphereGeom, glowGeom]);

  /* ─── graph data: plain nodes + deduplicated links, NO union/virtual nodes ─── */

  const displayGraph = useMemo(() => {
    const nodes = (data?.nodes ?? []).map((n: any) => ({ ...n }));

    const seen  = new Set<string>();
    const links: any[] = [];

    for (const l of data?.links ?? []) {
      const src = getNodeId(l.source);
      const tgt = getNodeId(l.target);
      const bidir = l.type === "spouse" || l.type === "sibling";
      const key   = bidir
        ? `${pairKey(src, tgt)}|${l.type}`
        : `${src}|${tgt}|${l.type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ ...l, source: src, target: tgt, __id: key });
    }

    return { nodes, links };
  }, [data]);

  /* ─── neighbor highlighting (depth 1 from active node) ─── */

  useEffect(() => {
    const activeId =
      floatingMenu?.node?.id || selectedNodeId || hoverNode?.id;
    if (!activeId) {
      setHighlightNodes(new Set());
      setHighlightLinks(new Set());
      return;
    }

    const start = String(activeId);
    const adj   = new Map<string, string[]>();

    for (const l of displayGraph.links) {
      const s = getNodeId(l.source);
      const t = getNodeId(l.target);
      if (!adj.has(s)) adj.set(s, []);
      if (!adj.has(t)) adj.set(t, []);
      adj.get(s)!.push(t);
      adj.get(t)!.push(s);
    }

    const visited = new Set<string>([start]);
    for (const nb of adj.get(start) ?? []) visited.add(nb);

    const hl = new Set<string>();
    for (const l of displayGraph.links) {
      const s = getNodeId(l.source);
      const t = getNodeId(l.target);
      if (visited.has(s) && visited.has(t)) hl.add(l.__id ?? linkId(l));
    }

    setHighlightNodes(visited);
    setHighlightLinks(hl);
  }, [displayGraph.links, floatingMenu?.node?.id, hoverNode?.id, selectedNodeId]);

  /* ─── scene enhancements: fog + starfield ─── */

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;

    const scene = fg.scene();

    /* subtle starfield */
    const N   = 800;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const r     = 500 + Math.random() * 800;
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x445577,
      size: 0.6,
      transparent: true,
      opacity: 0.45,
    });
    const stars = new THREE.Points(geo, mat);
    stars.name = "__stars";
    scene.add(stars);

    return () => {
      const s = scene.getObjectByName("__stars");
      if (s) scene.remove(s);
      geo.dispose();
      mat.dispose();
    };
  }, []);

  /* ─── force configuration: pure force-directed, NO hierarchy ─── */

  const initForces = useCallback(() => {
    const fg = fgRef.current;
    if (!fg) return;

    fg.d3Force("charge")?.strength(-350);
    fg.d3Force("link")?.distance(110).iterations(3);
    fg.d3Force("center", d3Force.forceCenter(0, 0).strength(0.04));
    fg.d3Force("collision", d3Force.forceCollide(22));

    /* strip any previously-set hierarchy forces */
    fg.d3Force("y", null);
    fg.d3Force("x", null);
    fg.d3Force("z", null);
    fg.d3Force("dagRadial", null);

    fg.d3ReheatSimulation();
  }, []);

  useEffect(() => {
    const t = setTimeout(initForces, 250);
    return () => clearTimeout(t);
  }, [initForces]);

  const prevNodeCount = useRef(0);
  useEffect(() => {
    if (displayGraph.nodes.length !== prevNodeCount.current) {
      prevNodeCount.current = displayGraph.nodes.length;
      setTimeout(initForces, 120);
    }
  }, [displayGraph.nodes.length, initForces]);

  /* ─── hover position tracking ─── */

  useEffect(() => {
    if (!hoverNode || !fgRef.current) { setHoverPos(null); return; }
    let raf: number;
    const tick = () => {
      if (hoverNode?.x !== undefined && fgRef.current) {
        const c = fgRef.current.graph2ScreenCoords(hoverNode.x, hoverNode.y, hoverNode.z);
        setHoverPos({ x: c.x, y: c.y });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hoverNode]);

  /* ─── floating-menu position tracking ─── */

  useEffect(() => {
    if (!floatingMenu) return;
    let raf: number;
    const tick = () => {
      if (!fgRef.current) return;
      const nd = displayGraph.nodes.find(
        (n: any) => String(n.id) === String(floatingMenu.node.id),
      );
      if (nd?.x !== undefined) {
        const c = fgRef.current.graph2ScreenCoords(nd.x, nd.y, nd.z);
        setFloatingMenu((p) => (p ? { ...p, sx: c.x, sy: c.y } : null));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayGraph.nodes, floatingMenu?.node?.id]);

  /* ─── focus / fly-to ─── */

  useEffect(() => {
    if (!focusNodeId || !fgRef.current) return;
    const t = setTimeout(() => {
      const nd = displayGraph.nodes.find(
        (n: any) => String(n.id) === String(focusNodeId),
      );
      if (nd?.x !== undefined) {
        fgRef.current?.cameraPosition(
          { x: nd.x, y: nd.y - 30, z: (nd.z || 0) + 180 },
          nd,
          1400,
        );
      }
      onFocusHandled();
    }, 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNodeId]);

  /* ─── zoom-to-fit on data change ─── */

  useEffect(() => {
    if (fgRef.current && displayGraph.nodes.length > 0) {
      const t = setTimeout(() => fgRef.current?.zoomToFit(700, 100), 700);
      return () => clearTimeout(t);
    }
  }, [displayGraph.nodes.length, resetTick]);

  /* ─── escape to close menus ─── */

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setFloatingMenu(null); setAddForm(null); setLinkPopup(null); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  /* ─── orbit-controls workarounds ─── */

  useEffect(() => {
    const stopper = (e: PointerEvent) => {
      if (!e.isTrusted && e.pointerType === "touch" && e.type === "pointerup")
        e.stopImmediatePropagation();
    };
    document.addEventListener("pointerup", stopper, true);

    const applyZoom = () => {
      const c = fgRef.current?.controls();
      if (c?.zoomToCursor !== undefined) c.zoomToCursor = true;
      if (c?.enableDamping !== undefined) {
        c.enableDamping = true;
        c.dampingFactor = 0.12;
      }
    };
    applyZoom();
    const t = setTimeout(applyZoom, 600);
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerup", stopper, true);
    };
  }, []);

  /* ─── node THREE object ─── */

  const paintNode = useCallback(
    (node: any) => {
      const group = new THREE.Group();

      const isHovered  = node === hoverNode;
      const isSelected =
        floatingMenu?.node?.id === node.id || selectedNodeId === node.id;
      const hasHL    = highlightNodes.size > 0;
      const isGhost  = hasHL && !highlightNodes.has(String(node.id));

      /* colour */
      let color = new THREE.Color("#94a3b8");
      if (node.gender === "male")   color = new THREE.Color("#60a5fa");
      if (node.gender === "female") color = new THREE.Color("#f472b6");

      /* main sphere */
      const mat = new THREE.MeshPhongMaterial({
        color,
        emissive: color,
        emissiveIntensity: isSelected ? 0.65 : isHovered ? 0.5 : 0.22,
        transparent: true,
        opacity: isGhost ? 0.08 : 0.95,
        shininess: 120,
      });
      group.add(new THREE.Mesh(sphereGeom, mat));

      /* glow shell */
      if (!isGhost) {
        const glowMat = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: isSelected ? 0.24 : isHovered ? 0.18 : 0.06,
          side: THREE.BackSide,
        });
        const glow = new THREE.Mesh(glowGeom, glowMat);
        if (isSelected)     glow.scale.setScalar(1.35);
        else if (isHovered) glow.scale.setScalar(1.18);
        group.add(glow);
      }

      /* selection ring (sprite → always faces camera) */
      if (isSelected && !isGhost) {
        const rc = document.createElement("canvas");
        rc.width = 128; rc.height = 128;
        const rx = rc.getContext("2d")!;
        rx.beginPath();
        rx.arc(64, 64, 50, 0, Math.PI * 2);
        rx.lineWidth = 2.5;
        rx.strokeStyle = "rgba(255,255,255,0.75)";
        rx.stroke();
        const tex = new THREE.CanvasTexture(rc);
        tex.minFilter = THREE.LinearFilter;
        const sm = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
        const sp = new THREE.Sprite(sm);
        sp.scale.set(NODE_R * 3.6, NODE_R * 3.6, 1);
        group.add(sp);
      }

      /* label */
      const label = String(node.name ?? "");
      if (label) {
        const cv = document.createElement("canvas");
        cv.width = 512; cv.height = 128;
        const cx = cv.getContext("2d")!;
        const txt = label.length > 22 ? label.slice(0, 21) + "\u2026" : label;
        cx.font = '600 44px Inter, "Segoe UI", system-ui, sans-serif';
        cx.textAlign   = "center";
        cx.textBaseline = "middle";
        cx.shadowColor = "rgba(0,0,0,0.92)";
        cx.shadowBlur  = 12;
        cx.shadowOffsetY = 2;
        cx.fillStyle = isGhost
          ? "rgba(203,213,225,0.2)"
          : "rgba(248,250,252,0.94)";
        cx.fillText(txt, 256, 64);

        const tex = new THREE.CanvasTexture(cv);
        tex.minFilter = THREE.LinearFilter;
        const sm = new THREE.SpriteMaterial({
          map: tex,
          transparent: true,
          depthTest: false,
          opacity: isGhost ? 0.12 : 1,
        });
        const sp = new THREE.Sprite(sm);
        sp.scale.set(30, 7.5, 1);
        sp.position.set(0, -(NODE_R + 5.5), 0);
        group.add(sp);
      }

      return group;
    },
    [hoverNode, floatingMenu, selectedNodeId, highlightNodes, sphereGeom, glowGeom],
  );

  /* ─── link visual callbacks ─── */

  const linkColor = useCallback(
    (link: any): string => {
      const id = link.__id ?? linkId(link);
      const ghost = highlightNodes.size > 0 && !highlightLinks.has(id);
      if (ghost) return "rgba(100,116,139,0.04)";
      if (link.type === "spouse")  return "rgba(167,139,250,0.85)";
      if (link.type === "father")  return "rgba(96,165,250,0.80)";
      if (link.type === "mother")  return "rgba(244,114,182,0.80)";
      if (link.type === "sibling") return "rgba(251,146,60,0.80)";
      return "rgba(148,163,184,0.50)";
    },
    [highlightNodes, highlightLinks],
  );

  const getLinkParticles = useCallback(
    (link: any): number => {
      const id = link.__id ?? linkId(link);
      const ghost = highlightNodes.size > 0 && !highlightLinks.has(id);
      if (ghost) return 0;
      if (link.type === "father" || link.type === "mother") return 2;
      if (link.type === "spouse") return 1;
      return 0;
    },
    [highlightLinks, highlightNodes.size],
  );

  /* ─── event handlers ─── */

  const handleNodeClick = useCallback(
    (node: any) => {
      onNodeClick(node);
      if (!fgRef.current) return;
      const c = fgRef.current.graph2ScreenCoords(node.x, node.y, node.z);
      setFloatingMenu({ node, sx: c.x, sy: c.y });
      setAddForm(null);
    },
    [onNodeClick],
  );

  const handleBgClick = useCallback(() => {
    setFloatingMenu(null);
    setAddForm(null);
    setLinkPopup(null);
  }, []);

  const handlePlusClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!hoverNode || !fgRef.current) return;
      const c = fgRef.current.graph2ScreenCoords(
        hoverNode.x, hoverNode.y, hoverNode.z,
      );
      setFloatingMenu({ node: hoverNode, sx: c.x, sy: c.y });
      setAddForm(null);
      onNodeClick(hoverNode);
    },
    [hoverNode, onNodeClick],
  );

  const handleNodeHover = useCallback((node: any) => {
    setHoverNode(node ?? null);
    if (!node) setHoverPos(null);
  }, []);

  /* ─── link click / delete ─── */

  const handleLinkClick = useCallback(
    (link: any) => {
      if (!fgRef.current) return;
      const src = link.source;
      const tgt = link.target;
      const mx = ((src.x ?? 0) + (tgt.x ?? 0)) / 2;
      const my = ((src.y ?? 0) + (tgt.y ?? 0)) / 2;
      const mz = ((src.z ?? 0) + (tgt.z ?? 0)) / 2;
      const sc = fgRef.current.graph2ScreenCoords(mx, my, mz);
      setLinkPopup({ link, sx: sc.x, sy: sc.y });
    },
    [],
  );

  const handleDeleteLink = useCallback(
    async () => {
      if (!linkPopup) return;
      setDeletingLink(true);
      try {
        const link = linkPopup.link;
        const fromId = getNodeId(link.source);
        const toId = getNodeId(link.target);
        const relType = link.type ?? "";

        // Find the relationship by querying the backend
        const { data: found } = await api.get("/api/relationships/find", {
          params: { from: fromId, to: toId, type: relType },
        });
        if (found?.id) {
          await api.delete(`/api/relationships/${found.id}`);
          toast("Relationship deleted");
          await onRefresh();
        } else {
          toast("Relationship not found", "error");
        }
      } catch (err: any) {
        toast(err.response?.data?.error ?? "Failed to delete relationship", "error");
      } finally {
        setDeletingLink(false);
        setLinkPopup(null);
      }
    },
    [linkPopup, toast, onRefresh],
  );

  /* ─── relationship helpers ─── */

  const findSpouseId = useCallback(
    (personId: string): string | null => {
      for (const l of data?.links ?? []) {
        if (l.type !== "spouse") continue;
        const s = getNodeId(l.source);
        const t = getNodeId(l.target);
        if (s === personId) return t;
        if (t === personId) return s;
      }
      return null;
    },
    [data?.links],
  );

  const incomingParentLinks = useCallback(
    (childId: string) =>
      (data?.links ?? []).filter((l: any) => {
        if (l.type !== "father" && l.type !== "mother") return false;
        return getNodeId(l.target) === childId;
      }),
    [data?.links],
  );

  const defaultGenderForRole = useCallback((role: RoleKey, node: any) => {
    if (role === "spouse") {
      if (node?.gender === "male")   return "female";
      if (node?.gender === "female") return "male";
      return "male";
    }
    return ROLES.find((r) => r.key === role)?.defaultGender ?? "male";
  }, []);

  /* ─── optimize layout via backend ─── */

  const optimizeLayout = useCallback(
    async (withToast: boolean) => {
      setOptimizing(true);
      try {
        await api.post("/api/graph/layout/optimize");
        if (withToast) toast("Graph layout optimized");
      } catch {
        toast("Failed to optimize graph layout", "error");
      } finally {
        await onRefresh();
        setOptimizing(false);
      }
    },
    [onRefresh, toast],
  );

  /* ─── save new relative ─── */

  const handleSave = async () => {
    if (!addForm || !floatingMenu || !addForm.name.trim()) return;
    setSaving(true);
    try {
      const srcId = String(floatingMenu.node.id);
      const { data: np } = await api.post("/api/persons", {
        name: addForm.name.trim(),
        gender: addForm.gender,
      });
      const newId = String(np.id);

      if (addForm.role === "spouse") {
        await api.post("/api/relationships", {
          from_person_id: srcId, to_person_id: newId, type: "spouse",
        });
      }

      if (addForm.role === "father" || addForm.role === "mother") {
        await api.post("/api/relationships", {
          from_person_id: newId, to_person_id: srcId, type: addForm.role,
        });
      }

      if (addForm.role === "child") {
        const srcType = parentRelTypeForGender(floatingMenu.node.gender);
        await api.post("/api/relationships", {
          from_person_id: srcId, to_person_id: newId, type: srcType,
        });
        const spouseId = findSpouseId(srcId);
        if (spouseId) {
          const spouseNode = data.nodes.find(
            (n: any) => String(n.id) === spouseId,
          );
          const spouseType = parentRelTypeForGender(spouseNode?.gender);
          await api.post("/api/relationships", {
            from_person_id: spouseId, to_person_id: newId, type: spouseType,
          });
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
              from_person_id: pId, to_person_id: newId, type: p.type,
            });
          }
        } else {
          await api.post("/api/relationships", {
            from_person_id: srcId, to_person_id: newId, type: "sibling",
          });
        }
      }

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

  /* ─── view controls ─── */

  const resetView = useCallback(() => {
    if (!fgRef.current) return;
    fgRef.current.d3ReheatSimulation();
    fgRef.current.cameraPosition(
      { x: 0, y: 0, z: 480 }, { x: 0, y: 0, z: 0 }, 900,
    );
    setResetTick((t) => t + 1);
  }, []);

  const panelWidth  = selectedNodeId ? 320 : 0;
  const graphWidth  = Math.max(400, (size.width  ?? 1024) - panelWidth);
  const graphHeight = Math.max(300, (size.height ?? 768) - 56);

  const zoomBy = (factor: number) => {
    if (!fgRef.current) return;
    const p = fgRef.current.cameraPosition();
    fgRef.current.cameraPosition({ z: p.z * factor }, null, 280);
  };

  /* ─── render ─── */

  const nodeCount = displayGraph.nodes.length;

  return (
    <div
      className="relative w-full h-full cursor-move"
      style={{ background: BG_COLOR }}
    >
      <ForceGraph3D
        ref={fgRef}
        controlType="orbit"
        graphData={displayGraph}
        nodeId="id"
        nodeLabel=""
        nodeThreeObject={paintNode}
        nodeVal={1}
        linkColor={linkColor}
        linkWidth={0}
        linkOpacity={1}
        linkDirectionalParticles={getLinkParticles}
        linkDirectionalParticleColor={linkColor}
        linkDirectionalParticleWidth={1.8}
        linkDirectionalParticleSpeed={0.006}
        linkDirectionalArrowLength={0}
        linkCurvature={0}
        backgroundColor={BG_COLOR}
        width={graphWidth}
        height={graphHeight}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        onLinkClick={handleLinkClick}
        onBackgroundClick={handleBgClick}
        d3AlphaDecay={0.016}
        d3VelocityDecay={0.28}
        cooldownTicks={450}
        cooldownTime={14000}
      />

      {/* hover + button */}
      {hoverPos && hoverNode && !floatingMenu && (
        <button
          style={{
            left: hoverPos.x + 22,
            top: hoverPos.y - 28,
            transform: "translateY(-50%)",
          }}
          className="absolute z-20 w-7 h-7 rounded-full bg-blue-600/90 hover:bg-blue-400 text-white flex items-center justify-center shadow-[0_0_15px_rgba(59,130,246,0.6)] border border-blue-400/50 text-sm font-bold transition-all hover:scale-110 backdrop-blur-sm"
          onMouseDown={handlePlusClick}
          title="Add relative"
        >
          +
        </button>
      )}

      {/* floating action menu */}
      {floatingMenu && !addForm && (
        <div
          className="absolute z-30 pointer-events-auto animate-in fade-in zoom-in duration-200"
          style={{ left: floatingMenu.sx + 40, top: floatingMenu.sy - 90 }}
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
                  <span className="text-sm font-bold leading-none opacity-80">+</span>{" "}
                  {r.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => { setFloatingMenu(null); setAddForm(null); }}
              className="w-full mt-2 pt-2 border-t border-white/10 text-[11px] text-slate-400 hover:text-white transition-colors uppercase tracking-wider font-semibold"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* add-relative form */}
      {floatingMenu && addForm && (
        <div
          className="absolute z-30 pointer-events-auto animate-in fade-in slide-in-from-left-4 duration-200"
          style={{ left: floatingMenu.sx + 40, top: floatingMenu.sy - 90, width: 246 }}
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
                {saving ? "Saving\u2026" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* link delete popup */}
      {linkPopup && (
        <div
          className="absolute z-30 pointer-events-auto animate-in fade-in zoom-in duration-150"
          style={{ left: linkPopup.sx - 100, top: linkPopup.sy - 70 }}
        >
          <div className="bg-slate-950/80 border border-white/10 rounded-2xl shadow-[0_0_30px_rgba(0,0,0,0.6)] p-4 backdrop-blur-xl text-center" style={{ minWidth: 200 }}>
            <p className="text-xs text-slate-300 mb-1 font-medium">
              {(typeof linkPopup.link.source === "object" ? linkPopup.link.source.name : "") || "?"}
              <span className="mx-1.5 text-slate-500">→</span>
              {(typeof linkPopup.link.target === "object" ? linkPopup.link.target.name : "") || "?"}
            </p>
            <p className="text-[11px] text-slate-500 mb-3 uppercase tracking-wider font-semibold">
              {linkPopup.link.type ?? "relationship"}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setLinkPopup(null)}
                className="flex-1 py-1.5 text-xs font-semibold rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteLink}
                disabled={deletingLink}
                className="flex-1 py-1.5 text-xs font-semibold rounded-lg bg-red-600/80 hover:bg-red-500 text-white transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5"
              >
                <Trash2 className="w-3 h-3" />
                {deletingLink ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* graph controls */}
      <div className="absolute right-6 bottom-6 z-10 flex flex-col gap-2">
        <button
          onClick={() => zoomBy(0.67)}
          className="w-10 h-10 bg-slate-900/60 hover:bg-slate-800/80 border border-white/10 backdrop-blur-xl rounded-2xl text-white flex items-center justify-center shadow-lg transition-all hover:scale-105"
          title="Zoom in"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={() => zoomBy(1.5)}
          className="w-10 h-10 bg-slate-900/60 hover:bg-slate-800/80 border border-white/10 backdrop-blur-xl rounded-2xl text-white flex items-center justify-center shadow-lg transition-all hover:scale-105"
          title="Zoom out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={() => fgRef.current?.zoomToFit(600, 80)}
          className="w-10 h-10 bg-slate-900/60 hover:bg-slate-800/80 border border-white/10 backdrop-blur-xl rounded-2xl text-white flex items-center justify-center shadow-lg transition-all hover:scale-105 mt-1"
          title="Fit to view"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
        <button
          onClick={resetView}
          className="w-10 h-10 bg-cyan-900/45 hover:bg-cyan-800/70 border border-cyan-300/30 backdrop-blur-xl rounded-2xl text-cyan-200 flex items-center justify-center shadow-lg transition-all hover:scale-105"
          title="Reset view and reheat simulation"
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

      {/* legend */}
      <div className="absolute bottom-6 left-6 z-10">
        <button
          onClick={() => setLegendOpen((o) => !o)}
          className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 hover:text-white transition-colors mb-2 ml-1"
        >
          {legendOpen ? "\u25BE Legend" : "\u25B8 Legend"}
        </button>
        {legendOpen && (
          <div className="bg-slate-950/65 border border-white/10 rounded-2xl p-4 backdrop-blur-xl shadow-2xl pointer-events-none select-none animate-in fade-in slide-in-from-bottom-2">
            <div className="flex flex-col gap-2.5 text-[13px] font-medium">
              <div className="flex items-center gap-3">
                <span className="w-3.5 h-3.5 rounded-full bg-blue-400/20 border border-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.5)] flex-shrink-0" />
                <span className="text-slate-200">Male</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="w-3.5 h-3.5 rounded-full bg-pink-400/20 border border-pink-400 shadow-[0_0_8px_rgba(244,114,182,0.5)] flex-shrink-0" />
                <span className="text-slate-200">Female</span>
              </div>
              <div className="border-t border-white/10 mt-1 pt-2.5 flex flex-col gap-2">
                {[
                  { color: "#60a5fa", label: "Father" },
                  { color: "#f472b6", label: "Mother" },
                  { color: "#a78bfa", label: "Spouse" },
                  { color: "#fb923c", label: "Sibling" },
                ].map(({ color, label }) => (
                  <div key={label} className="flex items-center gap-3">
                    <span
                      className="h-[3px] w-6 rounded-full flex-shrink-0 shadow-sm"
                      style={{ background: color, boxShadow: `0 0 6px ${color}` }}
                    />
                    <span className="text-slate-300">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* hint bar */}
      {nodeCount > 0 && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
          <span className="text-xs font-medium tracking-wide text-slate-300 bg-slate-950/60 px-5 py-2.5 rounded-2xl border border-white/10 shadow-xl backdrop-blur-xl select-none">
            Click to select · Hover to add · Drag background to rotate
          </span>
        </div>
      )}

      {/* empty state */}
      {nodeCount === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
          <div className="text-center flex flex-col items-center gap-4 opacity-70">
            <div className="w-20 h-20 rounded-3xl bg-slate-900/60 border border-white/10 backdrop-blur-xl shadow-2xl flex items-center justify-center">
              <svg
                className="w-10 h-10 text-slate-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </div>
            <div>
              <p className="text-slate-300 text-lg font-bold tracking-tight">
                No family members yet
              </p>
              <p className="text-slate-500 text-sm mt-1.5 font-medium">
                Click &quot;+ Person&quot; in the toolbar to get started
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
