"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { familyApi } from "../lib/familyApi";

export const familyQueryKeys = {
	graph: ["family-tree", "graph"] as const,
	person: (personId: string) => ["family-tree", "person", personId] as const,
	search: (query: string) => ["family-tree", "search", query] as const,
};

export function useGraphQuery() {
	return useQuery({
		queryKey: familyQueryKeys.graph,
		queryFn: familyApi.fetchGraph,
		staleTime: 10_000,
	});
}

export function usePersonQuery(personId: string | null) {
	return useQuery({
		queryKey: familyQueryKeys.person(personId ?? "none"),
		queryFn: () => familyApi.fetchPerson(personId ?? ""),
		enabled: Boolean(personId),
	});
}

export function useSearchPersonsQuery(query: string) {
	return useQuery({
		queryKey: familyQueryKeys.search(query),
		queryFn: () => familyApi.searchPersons(query),
		enabled: query.trim().length > 0,
		staleTime: 30_000,
	});
}

export function useFamilyQueryUtils() {
	const queryClient = useQueryClient();

	const refreshGraph = useCallback(async () => {
		await queryClient.invalidateQueries({ queryKey: familyQueryKeys.graph });
		await queryClient.refetchQueries({ queryKey: familyQueryKeys.graph, type: "active" });
	}, [queryClient]);

	const refreshPerson = useCallback(async (personId: string | null) => {
		if (!personId) {
			return;
		}
		await queryClient.invalidateQueries({ queryKey: familyQueryKeys.person(personId) });
		await queryClient.refetchQueries({ queryKey: familyQueryKeys.person(personId), type: "active" });
	}, [queryClient]);

	const refreshAll = useCallback(async (personId: string | null) => {
		await refreshGraph();
		await refreshPerson(personId);
	}, [refreshGraph, refreshPerson]);

	return {
		queryClient,
		refreshGraph,
		refreshPerson,
		refreshAll,
	};
}