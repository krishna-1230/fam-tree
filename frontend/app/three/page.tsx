"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import api from "../../lib/api";
import Navbar from "../../components/Navbar";
import DetailPanel from "../../components/DetailPanel";
import { useToast } from "../../components/Toast";

const GraphCanvas = dynamic(() => import("../../components/GraphCanvas"), { ssr: false });

export default function ThreePage() {
  const [graphData, setGraphData] = useState<{ nodes: any[]; links: any[] }>({ nodes: [], links: [] });
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const { toast } = useToast();

  const normalizeGraphData = useCallback((raw: any) => {
    return {
      nodes: raw?.nodes ?? [],
      links: (raw?.links ?? []).map((l: any) => ({
        ...l,
        source: l.from_person_id,
        target: l.to_person_id,
      })),
    };
  }, []);

  const hasDbCoordinates = useCallback((node: any) => {
    const meta = node?.metadata;
    if (!meta || typeof meta !== "object") return false;
    const x = Number(meta.x);
    const y = Number(meta.y);
    const z = Number(meta.z);
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
  }, []);

  const fetchGraph = useCallback(async () => {
    try {
      const res = await api.get("/api/graph");
      let data = res.data;

      const nodes = data?.nodes ?? [];
      const needsLayoutOptimization = nodes.length > 0 && nodes.some((n: any) => !hasDbCoordinates(n));
      if (needsLayoutOptimization) {
        try {
          await api.post("/api/graph/layout/optimize");
          const optimized = await api.get("/api/graph");
          data = optimized.data;
        } catch {
          toast("Layout optimization is unavailable; showing current coordinates", "error");
        }
      }

      setGraphData(normalizeGraphData(data));
    } catch {
      toast("Failed to load family graph", "error");
    } finally {
      setIsLoading(false);
    }
  }, [hasDbCoordinates, normalizeGraphData, toast]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  const handleNodeClick = useCallback(async (node: any) => {
    const id = node?.id;
    if (!id) return;
    try {
      const res = await api.get(`/api/persons/${id}`);
      setSelectedNode(res.data);
    } catch {
      toast("Failed to load person details", "error");
    }
  }, [toast]);

  const handleRefreshPanel = useCallback(async () => {
    if (selectedNode?.id) {
      try {
        const res = await api.get(`/api/persons/${selectedNode.id}`);
        setSelectedNode(res.data);
      } catch {
        toast("Failed to refresh details", "error");
      }
    }
    await fetchGraph();
  }, [selectedNode?.id, fetchGraph, toast]);

  const handleSelectPerson = useCallback(async (personId: string) => {
    setFocusNodeId(personId);
    try {
      const res = await api.get(`/api/persons/${personId}`);
      setSelectedNode(res.data);
    } catch {
      toast("Failed to load person details", "error");
    }
  }, [toast]);

  return (
    <main className="flex flex-col h-screen w-full bg-slate-950 text-white overflow-hidden">
      <Navbar onRefresh={fetchGraph} persons={graphData.nodes} onSelectPerson={handleSelectPerson} />
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 h-full w-full min-w-0 relative">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full spinner" />
                <p className="text-slate-500 text-sm">Loading family tree…</p>
              </div>
            </div>
          ) : (
            <GraphCanvas
              data={graphData}
              onNodeClick={handleNodeClick}
              selectedNodeId={selectedNode?.id ?? null}
              focusNodeId={focusNodeId}
              onFocusHandled={() => setFocusNodeId(null)}
              onRefresh={fetchGraph}
            />
          )}
        </div>
        {selectedNode?.id && (
          <DetailPanel
            key={selectedNode.id}
            personData={selectedNode}
            onClose={() => setSelectedNode(null)}
            onRefresh={handleRefreshPanel}
            onDelete={async () => {
              setSelectedNode(null);
              await fetchGraph();
            }}
            onNavigate={handleSelectPerson}
          />
        )}
      </div>
    </main>
  );
}
