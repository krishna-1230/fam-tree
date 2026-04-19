import api from "./api";
import type {
	CreatePersonInput,
	CreateRelationshipInput,
	GraphData,
	GraphResponse,
	Person,
	PersonDetail,
	RawRelationshipRecord,
	RelationshipSource,
	UpdatePersonInput,
} from "./types";

function normalizeRelationshipSource(value?: RelationshipSource): RelationshipSource {
	return value === "inferred" ? "inferred" : "explicit";
}

export function normalizeGraphData(raw?: GraphResponse | null): GraphData {
	return {
		nodes: raw?.nodes ?? [],
		links: (raw?.links ?? []).map((link: RawRelationshipRecord) => ({
			...link,
			source: link.from_person_id,
			target: link.to_person_id,
			relationship_source: normalizeRelationshipSource(link.source),
		})),
	};
}

export function hasStoredCoordinates(person: Person): boolean {
	const metadata = person.metadata;
	if (!metadata || typeof metadata !== "object") {
		return false;
	}

	const x = Number(metadata.x);
	const y = Number(metadata.y);
	const z = Number(metadata.z);
	return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
}

export const familyApi = {
	async fetchGraph(): Promise<GraphData> {
		const initial = await api.get<GraphResponse>("/api/graph");
		let normalized = normalizeGraphData(initial.data);

		if (normalized.nodes.length > 0 && normalized.nodes.some((node) => !hasStoredCoordinates(node))) {
			await api.post("/api/graph/layout/optimize");
			const optimized = await api.get<GraphResponse>("/api/graph");
			normalized = normalizeGraphData(optimized.data);
		}

		return normalized;
	},

	async fetchPerson(personId: string): Promise<PersonDetail> {
		const response = await api.get<PersonDetail>(`/api/persons/${personId}`);
		return response.data;
	},

	async searchPersons(query: string): Promise<Person[]> {
		const response = await api.get<Person[]>(`/api/persons/search?q=${encodeURIComponent(query.trim())}`);
		return response.data ?? [];
	},

	async createPerson(payload: CreatePersonInput): Promise<{ id: string; message: string }> {
		const response = await api.post<{ id: string; message: string }>("/api/persons", payload);
		return response.data;
	},

	async updatePerson(personId: string, payload: UpdatePersonInput): Promise<void> {
		await api.put(`/api/persons/${personId}`, payload);
	},

	async deletePerson(personId: string): Promise<void> {
		await api.delete(`/api/persons/${personId}`);
	},

	async createRelationship(payload: CreateRelationshipInput): Promise<void> {
		await api.post("/api/relationships", payload);
	},

	async deleteRelationship(relationshipId: string): Promise<void> {
		await api.delete(`/api/relationships/${relationshipId}`);
	},

	async findRelationship(params: { from: string; to: string; type?: string }) {
		const response = await api.get<{ id: string } & Record<string, unknown>>("/api/relationships/find", { params });
		return response.data;
	},

	async optimizeGraphLayout(): Promise<void> {
		await api.post("/api/graph/layout/optimize");
	},
};