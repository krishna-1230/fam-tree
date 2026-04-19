"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { AlertTriangle, Sparkles } from "lucide-react";
import Navbar from "./Navbar";
import DetailPanel from "./DetailPanel";
import { useToast } from "./Toast";
import { useFamilyQueryUtils, useGraphQuery, usePersonQuery } from "../hooks/useFamilyTree";
import type { GraphData, GraphMode } from "../lib/types";

const GraphCanvas3D = dynamic(() => import("./GraphCanvas"), { ssr: false });
const GraphCanvas2D = dynamic(() => import("./GraphCanvas2D"), { ssr: false });

const EMPTY_GRAPH: GraphData = { nodes: [], links: [] };

interface FamilyTreeScreenProps {
	mode: GraphMode;
}

export default function FamilyTreeScreen({ mode }: FamilyTreeScreenProps) {
	const router = useRouter();
	const { toast } = useToast();
	const toastStateRef = useRef({ graphError: false, personError: false });
	const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
	const [focusNodeId, setFocusNodeId] = useState<string | null>(null);

	const graphQuery = useGraphQuery();
	const personQuery = usePersonQuery(selectedPersonId);
	const { refreshAll } = useFamilyQueryUtils();

	const graphData = graphQuery.data ?? EMPTY_GRAPH;
	const selectedPerson = personQuery.data ?? null;

	useEffect(() => {
		if (graphQuery.isError && !toastStateRef.current.graphError) {
			toastStateRef.current.graphError = true;
			toast("Failed to load family graph", "error");
		}
		if (!graphQuery.isError) {
			toastStateRef.current.graphError = false;
		}
	}, [graphQuery.isError, toast]);

	useEffect(() => {
		if (personQuery.isError && selectedPersonId && !toastStateRef.current.personError) {
			toastStateRef.current.personError = true;
			toast("Failed to load person details", "error");
		}
		if (!personQuery.isError) {
			toastStateRef.current.personError = false;
		}
	}, [personQuery.isError, selectedPersonId, toast]);

	const handleRefresh = useCallback(async () => {
		await refreshAll(selectedPersonId);
	}, [refreshAll, selectedPersonId]);

	const handleNodeClick = useCallback((node: { id?: string | number }) => {
		const nextId = node?.id ? String(node.id) : null;
		if (!nextId) {
			return;
		}
		setSelectedPersonId(nextId);
		setFocusNodeId(nextId);
	}, []);

	const handleSelectPerson = useCallback((personId: string) => {
		setSelectedPersonId(personId);
		setFocusNodeId(personId);
	}, []);

	const handleRefreshPanel = useCallback(async () => {
		await refreshAll(selectedPersonId);
	}, [refreshAll, selectedPersonId]);

	const handleModeChange = useCallback((nextMode: GraphMode) => {
		router.push(nextMode === "3d" ? "/three" : "/");
	}, [router]);

	const graphStatusText = graphQuery.isFetching && graphData.nodes.length > 0
		? "Refreshing graph"
		: mode === "3d"
			? "Explore Mode"
			: "Tree Mode";

	return (
		<main className="flex h-screen w-full flex-col overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(14,116,144,0.14),_transparent_32%),linear-gradient(180deg,_#08111f_0%,_#020617_100%)] text-white">
			<Navbar
				mode={mode}
				onRefresh={handleRefresh}
				persons={graphData.nodes}
				relationshipCount={graphData.links.length}
				onSelectPerson={handleSelectPerson}
				onModeChange={handleModeChange}
			/>
			<div className="relative flex min-h-0 flex-1 overflow-hidden">
				<div className="relative min-w-0 flex-1 overflow-hidden">
					<div className="pointer-events-none absolute inset-x-4 top-4 z-10 flex items-center justify-between gap-4">
						<div className="rounded-full border border-cyan-400/20 bg-slate-950/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-100 backdrop-blur-xl">
							{graphStatusText}
						</div>
						<div className="hidden rounded-full border border-white/10 bg-slate-950/60 px-4 py-2 text-xs text-slate-300 backdrop-blur-xl md:flex md:items-center md:gap-2">
							<Sparkles className="h-3.5 w-3.5 text-emerald-300" />
							<span>{mode === "3d" ? "Orbit, inspect, and trim explicit links" : "Drag locally, then refresh to return to stored layout"}</span>
						</div>
					</div>

					{graphQuery.isLoading ? (
						<div className="flex h-full items-center justify-center">
							<div className="rounded-[28px] border border-white/10 bg-slate-950/55 px-8 py-7 text-center shadow-2xl backdrop-blur-xl">
								<div className="mx-auto mb-4 h-10 w-10 rounded-full border-2 border-cyan-400/70 border-t-transparent spinner" />
								<p className="text-base font-semibold text-slate-100">Loading family workspace</p>
								<p className="mt-2 text-sm text-slate-400">Fetching graph data and stabilizing the view.</p>
							</div>
						</div>
					) : graphQuery.isError ? (
						<div className="flex h-full items-center justify-center p-6">
							<div className="max-w-md rounded-[32px] border border-red-500/20 bg-slate-950/72 p-8 text-center shadow-2xl backdrop-blur-xl">
								<div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/12 text-red-300">
									<AlertTriangle className="h-6 w-6" />
								</div>
								<h2 className="mt-5 text-xl font-semibold text-slate-50">Graph data is unavailable</h2>
								<p className="mt-3 text-sm leading-6 text-slate-400">
									The frontend reached the API, but the graph query did not complete successfully. Retry after checking the backend connection.
								</p>
								<button
									type="button"
									onClick={() => void graphQuery.refetch()}
									className="mt-6 inline-flex items-center rounded-2xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-2.5 text-sm font-medium text-cyan-100 transition hover:border-cyan-300/50 hover:bg-cyan-500/15"
								>
									Retry graph request
								</button>
							</div>
						</div>
					) : mode === "3d" ? (
						<GraphCanvas3D
							data={graphData}
							onNodeClick={handleNodeClick}
							selectedNodeId={selectedPersonId}
							focusNodeId={focusNodeId}
							onFocusHandled={() => setFocusNodeId(null)}
							onRefresh={handleRefresh}
						/>
					) : (
						<GraphCanvas2D
							data={graphData}
							onNodeClick={handleNodeClick}
							selectedNodeId={selectedPersonId}
							focusNodeId={focusNodeId}
							onFocusHandled={() => setFocusNodeId(null)}
							onRefresh={handleRefresh}
						/>
					)}
				</div>

				{selectedPerson ? (
					<DetailPanel
						key={selectedPerson.id}
						personData={selectedPerson}
						onClose={() => setSelectedPersonId(null)}
						onRefresh={handleRefreshPanel}
						onDelete={async () => {
							setSelectedPersonId(null);
							await refreshAll(null);
						}}
						onNavigate={handleSelectPerson}
					/>
				) : null}
			</div>
		</main>
	);
}